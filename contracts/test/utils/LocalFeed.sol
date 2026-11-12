// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {AggregatorV3Interface} from "../../src/interfaces/AggregatorV3Interface.sol";

/// A local price feed for unit tests on Foundry's in-memory chain, where no Chainlink feed exists.
/// The fork suite (NorenCreditFork.t.sol) reads the real Chainlink feeds on Fuji instead.
contract LocalFeed is AggregatorV3Interface {
    int256 public answer;
    uint256 public updatedAt;
    uint80 public round;

    constructor(int256 answer_) {
        set(answer_);
    }

    function set(int256 answer_) public {
        answer = answer_;
        updatedAt = block.timestamp;
        round++;
    }

    function setUpdatedAt(uint256 t) external {
        updatedAt = t;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external pure returns (string memory) {
        return "local / USD";
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (round, answer, updatedAt, updatedAt, round);
    }
}
