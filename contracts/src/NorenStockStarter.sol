// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// One test stock pack per address (tNVDA, tTSLA, tAAPL, tMSFT, tSPY), so a judge's fresh wallet holds stocks to pay
/// with and borrow against. The owner stocks it by minting the test tokens into it.
contract NorenStockStarter is Ownable {
    using SafeERC20 for IERC20;

    address[] public tokens;
    uint256[] public amounts;
    mapping(address => bool) public claimed;

    event Claimed(address indexed who);
    event PackSet(address[] tokens, uint256[] amounts);

    error AlreadyClaimed();
    error LengthMismatch();
    error Empty(address token);

    constructor(address owner_, address[] memory tokens_, uint256[] memory amounts_) Ownable(owner_) {
        _set(tokens_, amounts_);
    }

    function setPack(address[] calldata tokens_, uint256[] calldata amounts_) external onlyOwner {
        _set(tokens_, amounts_);
    }

    function _set(address[] memory tokens_, uint256[] memory amounts_) internal {
        if (tokens_.length != amounts_.length) revert LengthMismatch();
        tokens = tokens_;
        amounts = amounts_;
        emit PackSet(tokens_, amounts_);
    }

    function pack() external view returns (address[] memory, uint256[] memory) {
        return (tokens, amounts);
    }

    function packsLeft() external view returns (uint256 n) {
        n = type(uint256).max;
        for (uint256 i; i < tokens.length; i++) {
            uint256 k = IERC20(tokens[i]).balanceOf(address(this)) / amounts[i];
            if (k < n) n = k;
        }
    }

    function claim() external {
        if (claimed[msg.sender]) revert AlreadyClaimed();
        claimed[msg.sender] = true;
        for (uint256 i; i < tokens.length; i++) {
            if (IERC20(tokens[i]).balanceOf(address(this)) < amounts[i]) revert Empty(tokens[i]);
            IERC20(tokens[i]).safeTransfer(msg.sender, amounts[i]);
        }
        emit Claimed(msg.sender);
    }
}
