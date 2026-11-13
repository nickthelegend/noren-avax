// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {NorenStockOracle} from "./NorenStockOracle.sol";

/// Noren's stock desk: pay with stocks. A customer sells test stock tokens (18 decimals) to the desk at the
/// NorenStockOracle price minus a spread and receives tUSDC (6 decimals), which the checkout then pays privately.
/// The Swap tab buys stock from the desk at the price plus the spread. Every trade refuses a stale price.
contract NorenStockDesk is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    /// 18-decimal stock * 8-decimal price -> 6-decimal USDC
    uint256 private constant SCALE = 1e20;

    IERC20 public immutable usdc;
    NorenStockOracle public immutable oracle;
    uint16 public spreadBps;

    event Sold(address indexed seller, address indexed token, uint256 amountIn, uint256 usdcOut, uint256 price8, address to);
    event Bought(address indexed buyer, address indexed token, uint256 usdcIn, uint256 amountOut, uint256 price8, address to);
    event SpreadSet(uint16 spreadBps);

    error ZeroAmount();
    error Slippage(uint256 got, uint256 min);
    error DeskShort(uint256 have, uint256 want);
    error BadSpread();

    constructor(address owner_, IERC20 usdc_, NorenStockOracle oracle_, uint16 spreadBps_) Ownable(owner_) {
        usdc = usdc_;
        oracle = oracle_;
        _setSpread(spreadBps_);
    }

    function setSpread(uint16 s) external onlyOwner {
        _setSpread(s);
    }

    function _setSpread(uint16 s) internal {
        if (s > 500) revert BadSpread();
        spreadBps = s;
        emit SpreadSet(s);
    }

    function _price(address token) internal view returns (uint256 p) {
        (p,,) = oracle.price(token);
    }

    /// tUSDC paid for `amountIn` of `token`.
    function quoteSell(address token, uint256 amountIn) public view returns (uint256 usdcOut, uint256 price8) {
        price8 = _price(token);
        usdcOut = amountIn * price8 * (BPS - spreadBps) / BPS / SCALE;
    }

    /// The smallest `amountIn` of `token` that pays at least `usdcOut`.
    function quoteSellIn(address token, uint256 usdcOut) public view returns (uint256 amountIn, uint256 price8) {
        price8 = _price(token);
        uint256 den = price8 * (BPS - spreadBps);
        amountIn = (usdcOut * SCALE * BPS + den - 1) / den;
    }

    function quoteBuy(address token, uint256 usdcIn) public view returns (uint256 amountOut, uint256 price8) {
        price8 = _price(token);
        amountOut = usdcIn * SCALE * BPS / (price8 * (BPS + spreadBps));
    }

    function sell(address token, uint256 amountIn, uint256 minUsdcOut, address to) external nonReentrant returns (uint256 usdcOut) {
        if (amountIn == 0) revert ZeroAmount();
        uint256 p;
        (usdcOut, p) = quoteSell(token, amountIn);
        if (usdcOut < minUsdcOut) revert Slippage(usdcOut, minUsdcOut);
        uint256 have = usdc.balanceOf(address(this));
        if (have < usdcOut) revert DeskShort(have, usdcOut);
        IERC20(token).safeTransferFrom(msg.sender, address(this), amountIn);
        usdc.safeTransfer(to, usdcOut);
        emit Sold(msg.sender, token, amountIn, usdcOut, p, to);
    }

    function buy(address token, uint256 usdcIn, uint256 minAmountOut, address to) external nonReentrant returns (uint256 amountOut) {
        if (usdcIn == 0) revert ZeroAmount();
        uint256 p;
        (amountOut, p) = quoteBuy(token, usdcIn);
        if (amountOut < minAmountOut) revert Slippage(amountOut, minAmountOut);
        uint256 have = IERC20(token).balanceOf(address(this));
        if (have < amountOut) revert DeskShort(have, amountOut);
        usdc.safeTransferFrom(msg.sender, address(this), usdcIn);
        IERC20(token).safeTransfer(to, amountOut);
        emit Bought(msg.sender, token, usdcIn, amountOut, p, to);
    }

    function sweep(IERC20 token, address to, uint256 amount) external onlyOwner {
        token.safeTransfer(to, amount);
    }
}
