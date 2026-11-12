// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// Test asset on Fuji (tUSDC, tWBTC). Anyone can draw a fixed amount from the faucet once a day;
/// the owner mints to seed the credit pool.
contract NorenTestToken is ERC20, Ownable {
    uint8 private immutable _decimals;
    uint256 public immutable faucetAmount;
    mapping(address => uint256) public lastDrip;

    error FaucetCooldown(uint256 nextAt);

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 faucetAmount_, address owner_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        _decimals = decimals_;
        faucetAmount = faucetAmount_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function faucet() external {
        uint256 next = lastDrip[msg.sender] + 1 days;
        if (lastDrip[msg.sender] != 0 && block.timestamp < next) revert FaucetCooldown(next);
        lastDrip[msg.sender] = block.timestamp;
        _mint(msg.sender, faucetAmount);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
