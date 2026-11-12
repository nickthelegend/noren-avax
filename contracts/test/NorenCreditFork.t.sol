// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {NorenCredit} from "../src/NorenCredit.sol";
import {NorenTestToken} from "../src/NorenTestToken.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";

/// Credit priced by the real Chainlink Data Feeds on a Fuji fork (no local feed).
/// Run: NOREN_FORK=1 forge test --match-contract NorenCreditForkTest
contract NorenCreditForkTest is Test {
    AggregatorV3Interface constant BTC_USD = AggregatorV3Interface(0x31CF013A08c6Ac228C94551d535d5BAfE19c602a);
    AggregatorV3Interface constant AVAX_USD = AggregatorV3Interface(0x5498BB86BC934c8D34FDA08E81D444153d0D06aD);

    NorenTestToken usdc;
    NorenTestToken wbtc;
    NorenCredit credit;
    address alice = makeAddr("alice");
    bool on;

    function setUp() public {
        on = vm.envOr("NOREN_FORK", false);
        if (!on) return;
        vm.createSelectFork("fuji");
        usdc = new NorenTestToken("Noren Test USDC", "tUSDC", 6, 250e6, address(this));
        wbtc = new NorenTestToken("Noren Test WBTC", "tWBTC", 8, 0.01e8, address(this));
        credit = new NorenCredit(usdc, 600, address(this));
        credit.listAsset(address(wbtc), BTC_USD, 6_000, 7_500, 500, 25 hours);
        credit.listAsset(address(0), AVAX_USD, 5_000, 6_500, 800, 25 hours);
        usdc.mint(address(this), 100_000e6);
        usdc.approve(address(credit), type(uint256).max);
        credit.fund(100_000e6);
    }

    function test_fork_feedsAreTheChainlinkOnes() public {
        if (!on) return vm.skip(true);
        assertEq(BTC_USD.description(), "BTC / USD");
        assertEq(AVAX_USD.description(), "AVAX / USD");
        (, int256 b,,,) = BTC_USD.latestRoundData();
        assertEq(credit.priceOf(address(wbtc)), uint256(b));
    }

    function test_fork_borrowAgainstRealBtcPrice() public {
        if (!on) return vm.skip(true);
        wbtc.mint(alice, 0.01e8);
        vm.startPrank(alice);
        wbtc.approve(address(credit), 0.01e8);
        credit.depositCollateral(address(wbtc), 0.01e8);
        uint256 px = credit.priceOf(address(wbtc));
        uint256 limit = 0.01e8 * px * 1e6 / 1e16 * 6_000 / 10_000;
        assertEq(credit.positionOf(alice).borrowLimit, limit);
        credit.borrow(limit, alice);
        vm.expectRevert();
        credit.borrow(1, alice);
        vm.stopPrank();
    }

    function test_fork_avaxCollateralAtRealPrice() public {
        if (!on) return vm.skip(true);
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        credit.depositAvax{value: 10 ether}();
        uint256 px = credit.priceOf(address(0));
        assertEq(credit.positionOf(alice).collateralValue, 10 ether * px * 1e6 / 1e26);
    }

    function test_fork_staleRealFeedRefused() public {
        if (!on) return vm.skip(true);
        (,,, uint256 updatedAt,) = BTC_USD.latestRoundData();
        vm.warp(updatedAt + 25 hours + 1);
        vm.expectRevert(abi.encodeWithSelector(NorenCredit.StalePrice.selector, address(wbtc), updatedAt, 25 hours));
        credit.priceOf(address(wbtc));
    }
}
