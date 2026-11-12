// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/// Noren credit line: borrow test USDC against coins (tWBTC, native AVAX) priced by Chainlink
/// Data Feeds on Fuji. A position is liquidatable once its health (liquidation value / debt)
/// drops below 1. Every price read refuses a feed older than its configured max age.
contract NorenCredit is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// Native AVAX is listed under this address.
    address public constant AVAX = address(0);
    uint256 private constant WAD = 1e18;
    uint256 private constant BPS = 10_000;
    uint256 private constant YEAR = 365 days;
    /// A liquidator may repay at most half the debt per call.
    uint256 public constant CLOSE_FACTOR_BPS = 5_000;

    struct Asset {
        bool listed;
        uint8 decimals;
        uint16 ltvBps; // borrow limit
        uint16 liqBps; // liquidation threshold
        uint16 bonusBps; // liquidator bonus
        uint32 maxAge; // seconds a price may be old
        AggregatorV3Interface feed;
    }

    struct Position {
        uint256 collateralValue; // USDC (6 decimals)
        uint256 borrowLimit;
        uint256 liquidationValue;
        uint256 debt;
        uint256 health; // WAD; type(uint256).max with no debt
    }

    IERC20 public immutable usdc;
    uint8 public immutable usdcDecimals;

    mapping(address => Asset) public assets;
    address[] public assetList;
    mapping(address => mapping(address => uint256)) public collateralOf;

    /// Debt is stored scaled by the borrow index so interest accrues without touching every account.
    uint256 public borrowIndex = WAD;
    uint256 public aprBps;
    uint256 public lastAccrual;
    uint256 public totalScaledDebt;
    mapping(address => uint256) public scaledDebtOf;

    event AssetListed(address indexed asset, address feed, uint16 ltvBps, uint16 liqBps, uint16 bonusBps, uint32 maxAge);
    event RateSet(uint256 aprBps);
    event Funded(address indexed from, uint256 amount);
    event CollateralDeposited(address indexed user, address indexed asset, uint256 amount);
    event CollateralWithdrawn(address indexed user, address indexed asset, uint256 amount);
    event Borrowed(address indexed user, address indexed to, uint256 amount, uint256 debt);
    event Repaid(address indexed payer, address indexed user, uint256 amount, uint256 debt);
    event Liquidated(
        address indexed liquidator, address indexed user, address indexed asset, uint256 repaid, uint256 seized
    );

    error UnknownAsset(address asset);
    error BadParams();
    error ZeroAmount();
    error StalePrice(address asset, uint256 updatedAt, uint256 maxAge);
    error BadPrice(address asset, int256 answer);
    error OverBorrowLimit(uint256 debt, uint256 limit);
    error InsufficientLiquidity(uint256 available, uint256 wanted);
    error InsufficientCollateral(uint256 have, uint256 wanted);
    error Unhealthy(uint256 health);
    error Healthy(uint256 health);
    error TooMuchRepay(uint256 max);
    error AvaxTransferFailed();

    constructor(IERC20 usdc_, uint256 aprBps_, address owner_) Ownable(owner_) {
        usdc = usdc_;
        usdcDecimals = IERC20Metadata(address(usdc_)).decimals();
        if (aprBps_ > 5_000) revert BadParams();
        aprBps = aprBps_;
        lastAccrual = block.timestamp;
        emit RateSet(aprBps_);
    }

    // ------------------------------------------------------------------ admin

    function listAsset(address asset, AggregatorV3Interface feed, uint16 ltvBps, uint16 liqBps, uint16 bonusBps, uint32 maxAge)
        external
        onlyOwner
    {
        if (address(feed) == address(0) || ltvBps == 0 || ltvBps >= liqBps || liqBps >= BPS || bonusBps > 2_000) {
            revert BadParams();
        }
        if (maxAge == 0 || maxAge > 3 days) revert BadParams();
        if (uint256(liqBps) * (BPS + bonusBps) > BPS * BPS) revert BadParams(); // a liquidation must not seize more than backs the debt
        uint8 dec = asset == AVAX ? 18 : IERC20Metadata(asset).decimals();
        if (!assets[asset].listed) assetList.push(asset);
        assets[asset] = Asset(true, dec, ltvBps, liqBps, bonusBps, maxAge, feed);
        emit AssetListed(asset, address(feed), ltvBps, liqBps, bonusBps, maxAge);
    }

    function setRate(uint256 aprBps_) external onlyOwner {
        if (aprBps_ > 5_000) revert BadParams();
        _accrue();
        aprBps = aprBps_;
        emit RateSet(aprBps_);
    }

    /// Adds lending liquidity (test USDC) to the pool.
    function fund(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    // ------------------------------------------------------------------ collateral

    function depositCollateral(address asset, uint256 amount) external nonReentrant {
        if (asset == AVAX || !assets[asset].listed) revert UnknownAsset(asset);
        if (amount == 0) revert ZeroAmount();
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        collateralOf[msg.sender][asset] += amount;
        emit CollateralDeposited(msg.sender, asset, amount);
    }

    function depositAvax() external payable nonReentrant {
        if (!assets[AVAX].listed) revert UnknownAsset(AVAX);
        if (msg.value == 0) revert ZeroAmount();
        collateralOf[msg.sender][AVAX] += msg.value;
        emit CollateralDeposited(msg.sender, AVAX, msg.value);
    }

    function withdrawCollateral(address asset, uint256 amount) external nonReentrant {
        if (!assets[asset].listed) revert UnknownAsset(asset);
        if (amount == 0) revert ZeroAmount();
        uint256 have = collateralOf[msg.sender][asset];
        if (have < amount) revert InsufficientCollateral(have, amount);
        _accrue();
        collateralOf[msg.sender][asset] = have - amount;
        if (scaledDebtOf[msg.sender] != 0) {
            Position memory p = _position(msg.sender);
            if (p.debt > p.borrowLimit) revert OverBorrowLimit(p.debt, p.borrowLimit);
        }
        _send(asset, msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, asset, amount);
    }

    // ------------------------------------------------------------------ credit

    /// Borrows test USDC against the caller's collateral and sends it to `to`.
    function borrow(uint256 amount, address to) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 available = usdc.balanceOf(address(this));
        if (available < amount) revert InsufficientLiquidity(available, amount);
        _accrue();
        uint256 scaled = _divUp(amount * WAD, borrowIndex);
        scaledDebtOf[msg.sender] += scaled;
        totalScaledDebt += scaled;
        Position memory p = _position(msg.sender);
        if (p.debt > p.borrowLimit) revert OverBorrowLimit(p.debt, p.borrowLimit);
        usdc.safeTransfer(to, amount);
        emit Borrowed(msg.sender, to, amount, p.debt);
    }

    /// Repays `amount` of `user`'s debt (anyone may repay for anyone). type(uint256).max repays all.
    function repay(address user, uint256 amount) external nonReentrant returns (uint256 paid) {
        _accrue();
        uint256 debt = debtOf(user);
        if (debt == 0 || amount == 0) revert ZeroAmount();
        paid = amount > debt ? debt : amount;
        usdc.safeTransferFrom(msg.sender, address(this), paid);
        _reduceDebt(user, paid, debt);
        emit Repaid(msg.sender, user, paid, debtOf(user));
    }

    /// Repays up to half of an unhealthy position's debt and seizes collateral worth the repayment
    /// plus the asset's bonus, at the Chainlink price.
    function liquidate(address user, address asset, uint256 repayAmount)
        external
        nonReentrant
        returns (uint256 repaid, uint256 seized)
    {
        Asset memory a = assets[asset];
        if (!a.listed) revert UnknownAsset(asset);
        if (repayAmount == 0) revert ZeroAmount();
        _accrue();
        Position memory p = _position(user);
        if (p.health >= WAD) revert Healthy(p.health);
        uint256 maxRepay = p.debt * CLOSE_FACTOR_BPS / BPS;
        if (repayAmount > maxRepay) revert TooMuchRepay(maxRepay);

        uint256 price = _price(asset, a); // USD, 8 decimals
        uint256 col = collateralOf[user][asset];
        repaid = repayAmount;
        seized = _usdcToAsset(repaid * (BPS + a.bonusBps) / BPS, price, a.decimals);
        if (seized > col) {
            // Not enough of this asset: take all of it and charge only what it covers.
            seized = col;
            repaid = _assetToUsdc(col, price, a.decimals) * BPS / (BPS + a.bonusBps);
            if (repaid == 0) revert InsufficientCollateral(col, 1);
        }
        usdc.safeTransferFrom(msg.sender, address(this), repaid);
        _reduceDebt(user, repaid, p.debt);
        collateralOf[user][asset] = col - seized;
        _send(asset, msg.sender, seized);
        emit Liquidated(msg.sender, user, asset, repaid, seized);
    }

    // ------------------------------------------------------------------ views

    function debtOf(address user) public view returns (uint256) {
        uint256 s = scaledDebtOf[user];
        if (s == 0) return 0;
        return _divUp(s * _currentIndex(), WAD);
    }

    function totalDebt() external view returns (uint256) {
        return totalScaledDebt * _currentIndex() / WAD;
    }

    function liquidity() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function positionOf(address user) external view returns (Position memory) {
        return _positionAt(user, _currentIndex());
    }

    /// Chainlink USD price with 8 decimals; reverts when the feed is stale or non-positive.
    function priceOf(address asset) external view returns (uint256) {
        Asset memory a = assets[asset];
        if (!a.listed) revert UnknownAsset(asset);
        return _price(asset, a);
    }

    function assetCount() external view returns (uint256) {
        return assetList.length;
    }

    /// How much more the user can borrow right now.
    function availableToBorrow(address user) external view returns (uint256) {
        Position memory p = _positionAt(user, _currentIndex());
        if (p.debt >= p.borrowLimit) return 0;
        uint256 room = p.borrowLimit - p.debt;
        uint256 cash = usdc.balanceOf(address(this));
        return room < cash ? room : cash;
    }

    // ------------------------------------------------------------------ internal

    function _accrue() internal {
        uint256 idx = _currentIndex();
        if (idx != borrowIndex) borrowIndex = idx;
        lastAccrual = block.timestamp;
    }

    function _currentIndex() internal view returns (uint256) {
        uint256 dt = block.timestamp - lastAccrual;
        if (dt == 0 || aprBps == 0) return borrowIndex;
        return borrowIndex + borrowIndex * aprBps * dt / (BPS * YEAR);
    }

    function _reduceDebt(address user, uint256 paid, uint256 debt) internal {
        uint256 s = scaledDebtOf[user];
        uint256 burn = paid == debt ? s : paid * WAD / borrowIndex;
        if (burn > s) burn = s;
        scaledDebtOf[user] = s - burn;
        totalScaledDebt -= burn;
    }

    function _position(address user) internal view returns (Position memory) {
        return _positionAt(user, borrowIndex);
    }

    function _positionAt(address user, uint256 index) internal view returns (Position memory p) {
        uint256 s = scaledDebtOf[user];
        p.debt = s == 0 ? 0 : _divUp(s * index, WAD);
        uint256 n = assetList.length;
        for (uint256 i; i < n; ++i) {
            address asset = assetList[i];
            uint256 amt = collateralOf[user][asset];
            if (amt == 0) continue;
            Asset memory a = assets[asset];
            uint256 v = _assetToUsdc(amt, _price(asset, a), a.decimals);
            p.collateralValue += v;
            p.borrowLimit += v * a.ltvBps / BPS;
            p.liquidationValue += v * a.liqBps / BPS;
        }
        p.health = p.debt == 0 ? type(uint256).max : p.liquidationValue * WAD / p.debt;
    }

    function _price(address asset, Asset memory a) internal view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = a.feed.latestRoundData();
        if (answer <= 0) revert BadPrice(asset, answer);
        if (updatedAt == 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > a.maxAge) {
            revert StalePrice(asset, updatedAt, a.maxAge);
        }
        return uint256(answer);
    }

    /// asset amount -> USDC units, with an 8-decimal USD price.
    function _assetToUsdc(uint256 amount, uint256 price, uint8 dec) internal view returns (uint256) {
        return amount * price * (10 ** usdcDecimals) / (10 ** (uint256(dec) + 8));
    }

    function _usdcToAsset(uint256 value, uint256 price, uint8 dec) internal view returns (uint256) {
        return value * (10 ** (uint256(dec) + 8)) / (price * (10 ** usdcDecimals));
    }

    function _send(address asset, address to, uint256 amount) internal {
        if (asset == AVAX) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert AvaxTransferFailed();
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
    }

    function _divUp(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }
}
