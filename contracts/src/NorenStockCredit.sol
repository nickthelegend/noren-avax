// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {NorenStockOracle} from "./NorenStockOracle.sol";

/// Credit against stocks, without selling them.
///
/// A customer locks test stock tokens; the credit limit is their value at NorenStockOracle prices times a loan-to-value
/// that starts at 60% and rises 5 points with every installment repaid on time, up to 75%. Credit is drawn as a plan:
/// pay in 3 (three installments, two weeks apart) or pay later (one payment in 30 days), with a flat 1% fee and no
/// interest. The tUSDC lent comes from the Earn pool: anyone can supply tUSDC for shares, and the fees repaid raise
/// the value of a share. A position whose debt exceeds 85% of its collateral value can be liquidated with a 5% bonus.
contract NorenStockCredit is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    uint256 private constant SCALE = 1e20; // 18-decimal stock * 8-decimal price -> 6-decimal USDC
    uint16 public constant BASE_LTV_BPS = 6_000;
    uint16 public constant STEP_BPS = 500;
    uint16 public constant MAX_LTV_BPS = 7_500;
    uint16 public constant LIQ_BPS = 8_500;
    uint16 public constant BONUS_BPS = 500;
    uint16 public constant FEE_BPS = 100;
    uint32 public constant GRACE = 3 days;
    uint32 public constant PAY_IN_3_INTERVAL = 14 days;
    uint32 public constant PAY_LATER_TERM = 30 days;
    uint256 public constant MIN_PLAN = 1e6; // 1 tUSDC

    struct Plan {
        address borrower;
        uint8 parts;
        uint8 paid;
        bool closed;
        uint64 start;
        uint32 interval;
        uint128 total; // principal + fee
        uint128 principal;
        uint128 repaid;
        bytes32 ref; // the customer's own reference (an order code); never a shop identity
    }

    IERC20 public immutable usdc;
    NorenStockOracle public immutable oracle;

    address[] public assetList;
    mapping(address => bool) public listed;
    mapping(address => mapping(address => uint256)) public collateralOf;

    mapping(address => uint256) public owed; // principal + fee outstanding
    mapping(address => uint256) public principalOf; // principal outstanding
    mapping(address => uint32) public onTimeOf;
    mapping(address => uint32) public lateOf;
    Plan[] internal plans;
    mapping(address => uint256[]) internal plansOf;

    // Earn pool
    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;
    uint256 public outstandingPrincipal;
    uint256 public feesEarned;

    event AssetListed(address indexed token);
    event Locked(address indexed user, address indexed token, uint256 amount);
    event Unlocked(address indexed user, address indexed token, uint256 amount);
    event PlanOpened(
        uint256 indexed planId, address indexed borrower, uint8 parts, uint256 principal, uint256 fee, uint256 limitAfter, bytes32 ref, address to
    );
    event InstallmentPaid(uint256 indexed planId, address indexed borrower, uint8 part, uint256 amount, bool onTime, uint32 onTimeTotal);
    event PlanClosed(uint256 indexed planId);
    event Supplied(address indexed who, uint256 amount, uint256 shares);
    event Withdrawn(address indexed who, uint256 amount, uint256 shares);
    event Liquidated(address indexed liquidator, address indexed user, address indexed token, uint256 repaid, uint256 seized);

    error UnknownAsset(address token);
    error ZeroAmount();
    error BadParts(uint8 parts);
    error OverLimit(uint256 owedAfter, uint256 limit);
    error PoolShort(uint256 have, uint256 want);
    error NotBorrower();
    error PlanDone();
    error Insufficient(uint256 have, uint256 want);
    error Healthy(uint256 owed, uint256 liquidationValue);
    error TooMuch(uint256 max);

    constructor(address owner_, IERC20 usdc_, NorenStockOracle oracle_) Ownable(owner_) {
        usdc = usdc_;
        oracle = oracle_;
    }

    function listAsset(address token) external onlyOwner {
        if (!listed[token]) {
            listed[token] = true;
            assetList.push(token);
            emit AssetListed(token);
        }
    }

    function assetCount() external view returns (uint256) {
        return assetList.length;
    }

    // ------------------------------------------------------------------ collateral

    function lock(address token, uint256 amount) external nonReentrant {
        if (!listed[token]) revert UnknownAsset(token);
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        collateralOf[msg.sender][token] += amount;
        emit Locked(msg.sender, token, amount);
    }

    function unlock(address token, uint256 amount) external nonReentrant {
        uint256 have = collateralOf[msg.sender][token];
        if (amount == 0) revert ZeroAmount();
        if (have < amount) revert Insufficient(have, amount);
        collateralOf[msg.sender][token] = have - amount;
        if (owed[msg.sender] != 0) {
            uint256 limit = creditLimit(msg.sender);
            if (owed[msg.sender] > limit) revert OverLimit(owed[msg.sender], limit);
        }
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Unlocked(msg.sender, token, amount);
    }

    // ------------------------------------------------------------------ limits

    function ltvBps(address user) public view returns (uint256) {
        uint256 l = BASE_LTV_BPS + uint256(onTimeOf[user]) * STEP_BPS;
        return l > MAX_LTV_BPS ? MAX_LTV_BPS : l;
    }

    /// Collateral value in tUSDC (6 decimals) at fresh oracle prices; reverts on a stale price.
    function collateralValue(address user) public view returns (uint256 v) {
        for (uint256 i; i < assetList.length; i++) {
            address t = assetList[i];
            uint256 a = collateralOf[user][t];
            if (a == 0) continue;
            (uint256 p,,) = oracle.price(t);
            v += a * p / SCALE;
        }
    }

    function creditLimit(address user) public view returns (uint256) {
        return collateralValue(user) * ltvBps(user) / BPS;
    }

    function available(address user) public view returns (uint256) {
        uint256 l = creditLimit(user);
        return l > owed[user] ? l - owed[user] : 0;
    }

    function liquidationValue(address user) public view returns (uint256) {
        return collateralValue(user) * LIQ_BPS / BPS;
    }

    // ------------------------------------------------------------------ plans

    /// Draws `principal` tUSDC to `to` as a plan of `parts` installments (3 = pay in 3, 1 = pay later).
    function openPlan(uint256 principal, uint8 parts, bytes32 ref, address to) external nonReentrant returns (uint256 id) {
        if (parts != 1 && parts != 3) revert BadParts(parts);
        if (principal < MIN_PLAN) revert ZeroAmount();
        uint256 fee = principal * FEE_BPS / BPS;
        uint256 owedAfter = owed[msg.sender] + principal + fee;
        uint256 limit = creditLimit(msg.sender);
        if (owedAfter > limit) revert OverLimit(owedAfter, limit);
        uint256 cash = usdc.balanceOf(address(this));
        if (cash < principal) revert PoolShort(cash, principal);

        owed[msg.sender] = owedAfter;
        principalOf[msg.sender] += principal;
        outstandingPrincipal += principal;
        id = plans.length;
        plans.push(
            Plan({
                borrower: msg.sender,
                parts: parts,
                paid: 0,
                closed: false,
                start: uint64(block.timestamp),
                interval: parts == 3 ? PAY_IN_3_INTERVAL : PAY_LATER_TERM,
                total: uint128(principal + fee),
                principal: uint128(principal),
                repaid: 0,
                ref: ref
            })
        );
        plansOf[msg.sender].push(id);
        usdc.safeTransfer(to, principal);
        emit PlanOpened(id, msg.sender, parts, principal, fee, limit - owedAfter, ref, to);
    }

    function planCount() external view returns (uint256) {
        return plans.length;
    }

    function plan(uint256 id) external view returns (Plan memory) {
        return plans[id];
    }

    function plansOfUser(address user) external view returns (uint256[] memory) {
        return plansOf[user];
    }

    /// Due time of installment `part` (0-based): two weeks apart for pay in 3, 30 days for pay later.
    function dueAt(uint256 id, uint8 part) public view returns (uint256) {
        Plan storage p = plans[id];
        return uint256(p.start) + uint256(p.interval) * (uint256(part) + 1);
    }

    /// The amount of the next installment (the last one takes the rounding remainder).
    function nextInstallment(uint256 id) public view returns (uint256) {
        Plan storage p = plans[id];
        if (p.closed) return 0;
        uint256 left = uint256(p.total) - p.repaid;
        if (p.paid + 1 == p.parts) return left;
        uint256 part = uint256(p.total) / p.parts;
        return part < left ? part : left;
    }

    /// Pays the next installment of a plan (anyone may pay; reputation goes to the borrower).
    function payInstallment(uint256 id) external nonReentrant {
        Plan storage p = plans[id];
        if (p.closed) revert PlanDone();
        address b = p.borrower;
        uint256 amount = nextInstallment(id);
        uint256 o = owed[b];
        if (amount > o) amount = o; // a liquidation already repaid part of it
        uint8 part = p.paid;
        bool onTime = block.timestamp <= dueAt(id, part) + GRACE;

        // principal share of this installment, pro rata to the plan's total
        uint256 princ = amount * p.principal / p.total;
        if (princ > principalOf[b]) princ = principalOf[b];
        if (princ > outstandingPrincipal) princ = outstandingPrincipal;

        p.paid = part + 1;
        p.repaid += uint128(amount);
        owed[b] = o - amount;
        principalOf[b] -= princ;
        outstandingPrincipal -= princ;
        feesEarned += amount - princ;
        if (onTime) onTimeOf[b] += 1;
        else lateOf[b] += 1;
        if (p.paid == p.parts || owed[b] == 0) {
            p.closed = true;
            emit PlanClosed(id);
        }
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit InstallmentPaid(id, b, part, amount, onTime, onTimeOf[b]);
    }

    // ------------------------------------------------------------------ liquidation

    function liquidate(address user, address token, uint256 repay) external nonReentrant returns (uint256 seized) {
        if (!listed[token]) revert UnknownAsset(token);
        uint256 o = owed[user];
        uint256 lv = liquidationValue(user);
        if (o <= lv) revert Healthy(o, lv);
        uint256 max = (o + 1) / 2;
        if (repay == 0) revert ZeroAmount();
        if (repay > max) revert TooMuch(max);
        (uint256 p,,) = oracle.price(token);
        seized = repay * (BPS + BONUS_BPS) / BPS * SCALE / p;
        uint256 have = collateralOf[user][token];
        if (seized > have) seized = have;

        uint256 princ = repay > principalOf[user] ? principalOf[user] : repay;
        owed[user] = o - repay;
        principalOf[user] -= princ;
        outstandingPrincipal -= princ;
        feesEarned += repay - princ;
        collateralOf[user][token] = have - seized;
        if (owed[user] == 0) _closeAll(user);
        usdc.safeTransferFrom(msg.sender, address(this), repay);
        IERC20(token).safeTransfer(msg.sender, seized);
        emit Liquidated(msg.sender, user, token, repay, seized);
    }

    function _closeAll(address user) internal {
        uint256[] storage ids = plansOf[user];
        for (uint256 i; i < ids.length; i++) {
            Plan storage p = plans[ids[i]];
            if (!p.closed) {
                p.closed = true;
                emit PlanClosed(ids[i]);
            }
        }
    }

    // ------------------------------------------------------------------ Earn pool

    function totalAssets() public view returns (uint256) {
        return usdc.balanceOf(address(this)) + outstandingPrincipal;
    }

    function supply(uint256 amount) external nonReentrant returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        uint256 ta = totalAssets();
        shares = totalShares == 0 || ta == 0 ? amount : amount * totalShares / ta;
        if (shares == 0) revert ZeroAmount();
        totalShares += shares;
        sharesOf[msg.sender] += shares;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Supplied(msg.sender, amount, shares);
    }

    function withdraw(uint256 shares) external nonReentrant returns (uint256 amount) {
        uint256 have = sharesOf[msg.sender];
        if (shares == 0) revert ZeroAmount();
        if (have < shares) revert Insufficient(have, shares);
        amount = shares * totalAssets() / totalShares;
        uint256 cash = usdc.balanceOf(address(this));
        if (cash < amount) revert PoolShort(cash, amount);
        sharesOf[msg.sender] = have - shares;
        totalShares -= shares;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, shares);
    }

    function valueOf(address who) external view returns (uint256) {
        return totalShares == 0 ? 0 : sharesOf[who] * totalAssets() / totalShares;
    }
}
