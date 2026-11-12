// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {NorenCredit} from "../src/NorenCredit.sol";
import {NorenTestToken} from "../src/NorenTestToken.sol";
import {LocalFeed} from "./utils/LocalFeed.sol";

contract ReentrantBorrower {
    NorenCredit immutable credit;
    bool public attempted;
    bool public reentered;

    constructor(NorenCredit c) {
        credit = c;
    }

    function depositAvax() external payable {
        credit.depositAvax{value: msg.value}();
    }

    function borrow(uint256 amount) external {
        credit.borrow(amount, address(this));
    }

    function withdraw(uint256 amount) external {
        credit.withdrawCollateral(address(0), amount);
    }

    receive() external payable {
        if (attempted) return;
        attempted = true;
        // Try to borrow again while the withdrawal is still in flight.
        try credit.borrow(1e6, address(this)) {
            reentered = true;
        } catch {}
    }
}

contract NorenCreditTest is Test {
    NorenTestToken usdc;
    NorenTestToken wbtc;
    LocalFeed btcFeed;
    LocalFeed avaxFeed;
    NorenCredit credit;

    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address shop = makeAddr("shop");
    address liquidator = makeAddr("liquidator");

    uint32 constant MAX_AGE = 25 hours;
    int256 constant BTC = 73_000e8; // $73,000
    int256 constant AVAX_PX = 8.5e8; // $8.50

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new NorenTestToken("Noren Test USDC", "tUSDC", 6, 1_000e6, owner);
        wbtc = new NorenTestToken("Noren Test WBTC", "tWBTC", 8, 0.02e8, owner);
        btcFeed = new LocalFeed(BTC);
        avaxFeed = new LocalFeed(AVAX_PX);
        credit = new NorenCredit(usdc, 600, owner); // 6% APR
        vm.startPrank(owner);
        credit.listAsset(address(wbtc), btcFeed, 6_000, 7_500, 500, MAX_AGE);
        credit.listAsset(address(0), avaxFeed, 5_000, 6_500, 800, MAX_AGE);
        usdc.mint(owner, 1_000_000e6);
        usdc.approve(address(credit), type(uint256).max);
        credit.fund(500_000e6);
        wbtc.mint(alice, 1e8);
        wbtc.mint(bob, 1e8);
        usdc.mint(liquidator, 1_000_000e6);
        vm.stopPrank();
        vm.prank(alice);
        wbtc.approve(address(credit), type(uint256).max);
        vm.prank(bob);
        wbtc.approve(address(credit), type(uint256).max);
        vm.prank(liquidator);
        usdc.approve(address(credit), type(uint256).max);
    }

    function _depositBtc(address who, uint256 amt) internal {
        vm.prank(who);
        credit.depositCollateral(address(wbtc), amt);
    }

    // ------------------------------------------------------------- borrow and pay

    function test_borrowWithinLimit() public {
        _depositBtc(alice, 0.01e8); // $730 of BTC -> $438 limit at 60%
        NorenCredit.Position memory p = credit.positionOf(alice);
        assertEq(p.collateralValue, 730e6);
        assertEq(p.borrowLimit, 438e6);
        assertEq(p.liquidationValue, 547.5e6);
        vm.prank(alice);
        credit.borrow(400e6, alice);
        assertEq(usdc.balanceOf(alice), 400e6);
        assertEq(credit.debtOf(alice), 400e6);
        assertGt(credit.positionOf(alice).health, 1e18);
    }

    function test_borrowAndPay_sendsCreditStraightToTheShop() public {
        _depositBtc(alice, 0.01e8);
        vm.expectEmit(true, true, false, true, address(credit));
        emit NorenCredit.Borrowed(alice, shop, 120e6, 120e6);
        vm.prank(alice);
        credit.borrow(120e6, shop);
        assertEq(usdc.balanceOf(shop), 120e6);
        assertEq(usdc.balanceOf(alice), 0);
        assertEq(credit.debtOf(alice), 120e6, "the debt sits with the borrower, not the payee");
        assertEq(credit.debtOf(shop), 0);
    }

    function test_borrowOverLimitReverts() public {
        _depositBtc(alice, 0.01e8);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NorenCredit.OverBorrowLimit.selector, 438e6 + 1, 438e6));
        credit.borrow(438e6 + 1, alice);
    }

    function test_borrowWithoutCollateralReverts() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(NorenCredit.OverBorrowLimit.selector, 1e6, 0));
        credit.borrow(1e6, bob);
    }

    function test_borrowMoreThanPoolReverts() public {
        NorenCredit c2 = new NorenCredit(usdc, 0, owner);
        vm.startPrank(owner);
        c2.listAsset(address(wbtc), btcFeed, 6_000, 7_500, 500, MAX_AGE);
        usdc.approve(address(c2), 10e6);
        c2.fund(10e6);
        vm.stopPrank();
        vm.startPrank(alice);
        wbtc.approve(address(c2), type(uint256).max);
        c2.depositCollateral(address(wbtc), 0.01e8);
        vm.expectRevert(abi.encodeWithSelector(NorenCredit.InsufficientLiquidity.selector, 10e6, 11e6));
        c2.borrow(11e6, alice);
        vm.stopPrank();
    }

    function test_avaxCollateral() public {
        vm.deal(bob, 100 ether);
        vm.prank(bob);
        credit.depositAvax{value: 10 ether}(); // $85 at 50% -> $42.50
        assertEq(credit.positionOf(bob).borrowLimit, 42.5e6);
        vm.prank(bob);
        credit.borrow(42e6, bob);
        assertEq(usdc.balanceOf(bob), 42e6);
    }

    function test_mixedCollateralAddsUp() public {
        vm.deal(alice, 10 ether);
        _depositBtc(alice, 0.01e8);
        vm.prank(alice);
        credit.depositAvax{value: 10 ether}();
        NorenCredit.Position memory p = credit.positionOf(alice);
        assertEq(p.collateralValue, 730e6 + 85e6);
        assertEq(p.borrowLimit, 438e6 + 42.5e6);
    }

    function test_unlistedAssetReverts() public {
        NorenTestToken junk = new NorenTestToken("Junk", "JNK", 18, 1, address(this));
        vm.expectRevert(abi.encodeWithSelector(NorenCredit.UnknownAsset.selector, address(junk)));
        credit.depositCollateral(address(junk), 1);
    }

    // ------------------------------------------------------------- repay

    function test_repayPartialThenFull() public {
        _depositBtc(alice, 0.01e8);
        vm.prank(alice);
        credit.borrow(300e6, alice);
        vm.startPrank(alice);
        usdc.approve(address(credit), type(uint256).max);
        credit.repay(alice, 100e6);
        assertEq(credit.debtOf(alice), 200e6);
        vm.stopPrank();
        vm.prank(owner);
        usdc.mint(alice, 1e6); // cover rounding/interest
        vm.prank(alice);
        uint256 paid = credit.repay(alice, type(uint256).max);
        assertEq(paid, 200e6);
        assertEq(credit.debtOf(alice), 0);
        assertEq(credit.scaledDebtOf(alice), 0);
        assertEq(credit.totalScaledDebt(), 0);
    }

    function test_repayForSomeoneElse() public {
        _depositBtc(alice, 0.01e8);
        vm.prank(alice);
        credit.borrow(50e6, alice);
        vm.prank(liquidator);
        credit.repay(alice, 50e6);
        assertEq(credit.debtOf(alice), 0);
    }

    function test_repayWithNoDebtReverts() public {
        vm.expectRevert(NorenCredit.ZeroAmount.selector);
        credit.repay(alice, 1e6);
    }

    function test_interestAccruesAtTheApr() public {
        _depositBtc(alice, 0.1e8);
        vm.prank(alice);
        credit.borrow(1_000e6, alice);
        vm.warp(block.timestamp + 365 days);
        btcFeed.set(BTC); // keep the feed fresh
        assertApproxEqAbs(credit.debtOf(alice), 1_060e6, 1);
        vm.prank(owner);
        usdc.mint(alice, 60e6 + 1);
        vm.startPrank(alice);
        usdc.approve(address(credit), type(uint256).max);
        uint256 paid = credit.repay(alice, type(uint256).max);
        vm.stopPrank();
        assertApproxEqAbs(paid, 1_060e6, 1);
        assertEq(credit.debtOf(alice), 0);
    }

    function test_withdrawCollateralBlockedWhenItBreaksTheLimit() public {
        _depositBtc(alice, 0.01e8);
        vm.prank(alice);
        credit.borrow(400e6, alice);
        vm.prank(alice);
        vm.expectRevert(); // OverBorrowLimit
        credit.withdrawCollateral(address(wbtc), 0.002e8);
        // a small withdrawal that keeps the limit is fine: 0.0005 BTC leaves $693.5 * 0.6 = $416.1
        vm.prank(alice);
        credit.withdrawCollateral(address(wbtc), 0.0005e8);
        assertEq(wbtc.balanceOf(alice), 1e8 - 0.01e8 + 0.0005e8);
    }

    function test_withdrawAllAfterRepay() public {
        _depositBtc(alice, 0.01e8);
        vm.prank(alice);
        credit.borrow(10e6, alice);
        vm.startPrank(alice);
        usdc.approve(address(credit), type(uint256).max);
        credit.repay(alice, type(uint256).max);
        credit.withdrawCollateral(address(wbtc), 0.01e8);
        vm.stopPrank();
        assertEq(wbtc.balanceOf(alice), 1e8);
    }

    // ------------------------------------------------------------- liquidation

    function _aliceAtTheEdge() internal {
        _depositBtc(alice, 0.01e8); // $730
        vm.prank(alice);
        credit.borrow(438e6, alice); // max at 60%
    }

    function test_liquidationWhenHealthDropsBelowOne() public {
        _aliceAtTheEdge();
        vm.prank(liquidator);
        vm.expectRevert(); // Healthy
        credit.liquidate(alice, address(wbtc), 100e6);

        btcFeed.set(57_000e8); // $570 * 75% = $427.5 < $438
        NorenCredit.Position memory p = credit.positionOf(alice);
        assertLt(p.health, 1e18);

        uint256 repay = 200e6;
        vm.prank(liquidator);
        (uint256 repaid, uint256 seized) = credit.liquidate(alice, address(wbtc), repay);
        assertEq(repaid, repay);
        // $200 * 1.05 / $57,000 = 0.00368421 BTC
        assertEq(seized, uint256(210e6) * 1e8 * 1e8 / (57_000e8 * 1e6));
        assertEq(wbtc.balanceOf(liquidator), seized);
        assertEq(credit.debtOf(alice), 238e6);
        assertGt(credit.positionOf(alice).health, p.health, "liquidation improves health");
    }

    function test_liquidationRespectsTheCloseFactor() public {
        _aliceAtTheEdge();
        btcFeed.set(57_000e8);
        vm.prank(liquidator);
        vm.expectRevert(abi.encodeWithSelector(NorenCredit.TooMuchRepay.selector, 219e6));
        credit.liquidate(alice, address(wbtc), 219e6 + 1);
    }

    function test_liquidationCapsAtTheCollateralHeld() public {
        vm.deal(alice, 1 ether);
        _depositBtc(alice, 0.01e8);
        vm.prank(alice);
        credit.depositAvax{value: 1 ether}(); // $8.50 of AVAX
        vm.prank(alice);
        credit.borrow(438e6, alice);
        btcFeed.set(50_000e8);
        // Seize AVAX: only $8.50 is there, so the liquidator pays $8.50 / 1.08.
        vm.prank(liquidator);
        (uint256 repaid, uint256 seized) = credit.liquidate(alice, address(0), 100e6);
        assertEq(seized, 1 ether);
        assertEq(repaid, uint256(8.5e6) * 10_000 / 10_800);
        assertEq(liquidator.balance, 1 ether);
        assertEq(credit.collateralOf(alice, address(0)), 0);
    }

    // ------------------------------------------------------------- oracle safety

    function test_staleOracleRefusesBorrow() public {
        _depositBtc(alice, 0.01e8);
        vm.warp(block.timestamp + MAX_AGE + 1);
        uint256 at = btcFeed.updatedAt();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NorenCredit.StalePrice.selector, address(wbtc), at, MAX_AGE));
        credit.borrow(1e6, alice);
    }

    function test_staleOracleRefusesWithdrawAndLiquidationAndReads() public {
        _aliceAtTheEdge();
        btcFeed.set(57_000e8);
        vm.warp(block.timestamp + MAX_AGE + 1);
        vm.prank(alice);
        vm.expectRevert();
        credit.withdrawCollateral(address(wbtc), 1);
        vm.prank(liquidator);
        vm.expectRevert();
        credit.liquidate(alice, address(wbtc), 1e6);
        vm.expectRevert();
        credit.priceOf(address(wbtc));
        vm.expectRevert();
        credit.positionOf(alice);
    }

    function test_freshAgainAfterTheFeedUpdates() public {
        _depositBtc(alice, 0.01e8);
        vm.warp(block.timestamp + MAX_AGE + 1);
        btcFeed.set(BTC);
        vm.prank(alice);
        credit.borrow(1e6, alice);
        assertEq(credit.debtOf(alice) > 0, true);
    }

    function test_nonPositivePriceRefused() public {
        _depositBtc(alice, 0.01e8);
        btcFeed.set(0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NorenCredit.BadPrice.selector, address(wbtc), int256(0)));
        credit.borrow(1e6, alice);
        btcFeed.set(-1);
        vm.expectRevert(abi.encodeWithSelector(NorenCredit.BadPrice.selector, address(wbtc), int256(-1)));
        credit.priceOf(address(wbtc));
    }

    function test_futureTimestampRefused() public {
        btcFeed.setUpdatedAt(block.timestamp + 1);
        vm.expectRevert();
        credit.priceOf(address(wbtc));
    }

    // ------------------------------------------------------------- attacks and admin

    function test_reentrancyThroughAvaxWithdrawIsBlocked() public {
        ReentrantBorrower r = new ReentrantBorrower(credit);
        vm.deal(address(this), 10 ether);
        r.depositAvax{value: 10 ether}();
        r.withdraw(1 ether);
        assertTrue(r.attempted());
        assertFalse(r.reentered());
        assertEq(credit.debtOf(address(r)), 0);
    }

    function test_onlyOwnerListsAndSetsRate() public {
        vm.prank(alice);
        vm.expectRevert();
        credit.listAsset(address(wbtc), btcFeed, 9_000, 9_500, 0, MAX_AGE);
        vm.prank(alice);
        vm.expectRevert();
        credit.setRate(5_000);
    }

    function test_listAssetRejectsUnsafeParams() public {
        vm.startPrank(owner);
        vm.expectRevert(NorenCredit.BadParams.selector);
        credit.listAsset(address(wbtc), btcFeed, 8_000, 7_500, 500, MAX_AGE); // ltv >= liq
        vm.expectRevert(NorenCredit.BadParams.selector);
        credit.listAsset(address(wbtc), btcFeed, 6_000, 9_800, 500, MAX_AGE); // liq * (1+bonus) > 1
        vm.expectRevert(NorenCredit.BadParams.selector);
        credit.listAsset(address(wbtc), btcFeed, 6_000, 7_500, 500, 0); // no staleness bound
        vm.stopPrank();
    }

    function test_cannotLiquidateYourselfIntoProfitWhenHealthy() public {
        _depositBtc(alice, 0.01e8);
        vm.prank(alice);
        credit.borrow(100e6, alice);
        vm.prank(alice);
        vm.expectRevert();
        credit.liquidate(alice, address(wbtc), 10e6);
    }

    // ------------------------------------------------------------- fuzz

    /// Whatever is borrowed, a fresh position is never liquidatable.
    function testFuzz_borrowNeverOpensAnUnhealthyPosition(uint256 btcAmt, uint256 borrowAmt) public {
        btcAmt = bound(btcAmt, 1e4, 1e8);
        _depositBtc(alice, btcAmt);
        uint256 limit = credit.positionOf(alice).borrowLimit;
        borrowAmt = bound(borrowAmt, 1, limit + 1e6);
        vm.prank(alice);
        if (borrowAmt > limit) {
            vm.expectRevert();
            credit.borrow(borrowAmt, alice);
        } else {
            credit.borrow(borrowAmt, alice);
            assertGe(credit.positionOf(alice).health, 1e18);
        }
    }

    /// Repaying exactly what debtOf reports always clears the position.
    function testFuzz_fullRepayClears(uint256 borrowAmt, uint256 dt) public {
        _depositBtc(alice, 0.1e8);
        borrowAmt = bound(borrowAmt, 1, 4_000e6);
        dt = bound(dt, 0, 300 days);
        vm.prank(alice);
        credit.borrow(borrowAmt, alice);
        vm.warp(block.timestamp + dt);
        btcFeed.set(BTC);
        uint256 debt = credit.debtOf(alice);
        vm.prank(owner);
        usdc.mint(alice, debt);
        vm.startPrank(alice);
        usdc.approve(address(credit), type(uint256).max);
        credit.repay(alice, debt);
        vm.stopPrank();
        assertEq(credit.debtOf(alice), 0);
    }
}
