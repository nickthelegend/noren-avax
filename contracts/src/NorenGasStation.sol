// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title NorenGasStation: one tap from an empty wallet to a funded Noren test wallet on Fuji.
/// @notice A judge's or new customer's wallet has no AVAX, so it can't send its first transaction, and the public Fuji
///         faucet has a captcha. Noren's relayer (a key held by Noren's API) calls `drip` for it, and in that one
///         transaction the station sends a little AVAX for gas plus a starter pack of Noren's test tokens (tUSDC to
///         pay with, tWBTC to borrow against). The station pays only a wallet that:
///           - signed this exact request (station, chain, wallet, deadline) with its own key,
///           - has never been dripped before and holds no AVAX (a brand-new wallet),
///           - is not a contract,
///         and only while today's cap and the per-requester cap (a keyed hash of the requester's IP, computed by the
///         relayer, never the IP itself) have room. The limits live here, on-chain, so they hold across every server
///         instance and anyone can audit them on Snowtrace.
/// @dev Same design as KumiGasStation (avax/kumi-avax, same author), extended with the token pack.
contract NorenGasStation {
    using SafeERC20 for IERC20;

    address public owner;
    address public relayer;
    uint256 public dripAmount;
    uint32 public dailyCap; // drips per UTC day, all wallets
    uint16 public perTagDaily; // drips per UTC day per requester tag
    uint256 public totalDrips;

    IERC20 public immutable usdc;
    IERC20 public immutable wbtc;
    uint256 public usdcPack;
    uint256 public wbtcPack;

    uint256 public constant MAX_DEADLINE = 1 hours;

    mapping(address => bool) public dripped;
    mapping(uint256 => uint32) public dripsOnDay; // day => drips
    mapping(uint256 => mapping(bytes32 => uint16)) public tagOnDay; // day => tag => drips

    event Dripped(address indexed to, bytes32 indexed tag, uint256 amount, uint256 usdc, uint256 wbtc, uint256 day);
    event Configured(uint256 dripAmount, uint32 dailyCap, uint16 perTagDaily, uint256 usdcPack, uint256 wbtcPack);
    event RelayerSet(address relayer);
    event Withdrawn(address to, uint256 amount);

    error NotOwner();
    error NotRelayer();
    error Expired();
    error DeadlineTooFar();
    error BadSignature();
    error AlreadyDripped();
    error NotNew();
    error NotWallet();
    error DailyCapReached();
    error TagCapReached();
    error Empty();
    error TokensEmpty();
    error TransferFailed();
    error BadConfig();

    constructor(
        address relayer_,
        uint256 dripAmount_,
        uint32 dailyCap_,
        uint16 perTagDaily_,
        IERC20 usdc_,
        uint256 usdcPack_,
        IERC20 wbtc_,
        uint256 wbtcPack_
    ) {
        owner = msg.sender;
        relayer = relayer_;
        usdc = usdc_;
        wbtc = wbtc_;
        _config(dripAmount_, dailyCap_, perTagDaily_, usdcPack_, wbtcPack_);
        emit RelayerSet(relayer_);
    }

    receive() external payable {}

    /// @notice The 32-byte digest a wallet signs (EIP-191 personal_sign of these raw bytes) to ask for the pack.
    function digest(address to, uint256 deadline) public view returns (bytes32) {
        return keccak256(abi.encodePacked("Noren gas", block.chainid, address(this), to, deadline));
    }

    function today() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// @notice What is left today: total drips, drips for one tag, and the drips the AVAX and tokens can still pay.
    function room(bytes32 tag) external view returns (uint256 dayLeft, uint256 tagLeft, uint256 funded) {
        uint256 d = today();
        dayLeft = dailyCap - dripsOnDay[d];
        tagLeft = perTagDaily - tagOnDay[d][tag];
        funded = address(this).balance / dripAmount;
        if (usdcPack != 0) funded = _min(funded, usdc.balanceOf(address(this)) / usdcPack);
        if (wbtcPack != 0) funded = _min(funded, wbtc.balanceOf(address(this)) / wbtcPack);
    }

    function drip(address payable to, uint256 deadline, bytes calldata sig, bytes32 tag) external {
        if (msg.sender != relayer) revert NotRelayer();
        if (block.timestamp > deadline) revert Expired();
        if (deadline > block.timestamp + MAX_DEADLINE) revert DeadlineTooFar();
        if (_recover(digest(to, deadline), sig) != to) revert BadSignature();
        if (dripped[to]) revert AlreadyDripped();
        if (to.code.length != 0) revert NotWallet();
        if (to.balance != 0) revert NotNew();
        uint256 d = today();
        if (dripsOnDay[d] >= dailyCap) revert DailyCapReached();
        if (tagOnDay[d][tag] >= perTagDaily) revert TagCapReached();
        uint256 amount = dripAmount;
        if (address(this).balance < amount) revert Empty();
        uint256 u = usdcPack;
        uint256 w = wbtcPack;
        if (usdc.balanceOf(address(this)) < u || wbtc.balanceOf(address(this)) < w) revert TokensEmpty();

        dripped[to] = true;
        dripsOnDay[d]++;
        tagOnDay[d][tag]++;
        totalDrips++;
        emit Dripped(to, tag, amount, u, w, d);
        if (u != 0) usdc.safeTransfer(to, u);
        if (w != 0) wbtc.safeTransfer(to, w);
        (bool ok,) = to.call{value: amount, gas: 10_000}("");
        if (!ok) revert TransferFailed();
    }

    // ---------------------------------------------------------------- owner
    function configure(uint256 dripAmount_, uint32 dailyCap_, uint16 perTagDaily_, uint256 usdcPack_, uint256 wbtcPack_)
        external
        onlyOwner
    {
        _config(dripAmount_, dailyCap_, perTagDaily_, usdcPack_, wbtcPack_);
    }

    function setRelayer(address r) external onlyOwner {
        relayer = r;
        emit RelayerSet(r);
    }

    function withdraw(address payable to, uint256 amount) external onlyOwner {
        emit Withdrawn(to, amount);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function withdrawToken(IERC20 token, address to, uint256 amount) external onlyOwner {
        token.safeTransfer(to, amount);
    }

    function transferOwnership(address o) external onlyOwner {
        owner = o;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function _config(uint256 a, uint32 cap, uint16 perTag, uint256 u, uint256 w) internal {
        // A drip of zero, or more than 0.01 AVAX, is a mistake on a gas faucet.
        if (a == 0 || a > 0.01 ether || cap == 0 || perTag == 0) revert BadConfig();
        dripAmount = a;
        dailyCap = cap;
        perTagDaily = perTag;
        usdcPack = u;
        wbtcPack = w;
        emit Configured(a, cap, perTag, u, w);
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    /// @dev EIP-191 personal_sign recovery with low-s and v in {27, 28}; returns address(0) on anything malformed.
    function _recover(bytes32 h, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        bytes32 m = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
        return ecrecover(m, v, r, s);
    }
}
