// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NorenTestToken} from "../src/NorenTestToken.sol";
import {NorenStockOracle} from "../src/NorenStockOracle.sol";
import {NorenStockDesk} from "../src/NorenStockDesk.sol";
import {NorenStockCredit} from "../src/NorenStockCredit.sol";
import {NorenStockStarter} from "../src/NorenStockStarter.sol";

contract NorenStocksTest is Test {
    uint256 signerPk = 0xA11CE;
    address signer;
    address owner = address(0xB0B);
    address alice = address(0xA1);
    address bob = address(0xB2);
    address lender = address(0x1E);
    address liq = address(0x11);

    NorenTestToken usdc;
    NorenTestToken nvda;
    NorenTestToken tsla;
    NorenStockOracle oracle;
    NorenStockDesk desk;
    NorenStockCredit credit;

    function setUp() public {
        vm.warp(1_800_000_000);
        signer = vm.addr(signerPk);
        usdc = new NorenTestToken("Test USDC", "tUSDC", 6, 250e6, owner);
        nvda = new NorenTestToken("Noren test NVIDIA", "tNVDA", 18, 1e18, owner);
        tsla = new NorenTestToken("Noren test Tesla", "tTSLA", 18, 1e18, owner);
        oracle = new NorenStockOracle(owner, signer, 3600, "test quotes");
        vm.startPrank(owner);
        oracle.list(address(nvda), "NVDA");
        oracle.list(address(tsla), "TSLA");
        desk = new NorenStockDesk(owner, IERC20(address(usdc)), oracle, 50);
        credit = new NorenStockCredit(owner, IERC20(address(usdc)), oracle);
        credit.listAsset(address(nvda));
        credit.listAsset(address(tsla));
        usdc.mint(address(desk), 10_000e6);
        nvda.mint(address(desk), 10e18);
        usdc.mint(lender, 5_000e6);
        nvda.mint(alice, 10e18);
        tsla.mint(alice, 2e18);
        usdc.mint(alice, 1_000e6);
        usdc.mint(liq, 5_000e6);
        vm.stopPrank();

        vm.startPrank(lender);
        usdc.approve(address(credit), type(uint256).max);
        credit.supply(5_000e6);
        vm.stopPrank();

        _push(200e8, 400e8, uint64(block.timestamp));
    }

    // ------------------------------------------------------------------ helpers

    function _report(uint256 pN, uint256 pT, uint64 at)
        internal
        view
        returns (address[] memory t, uint256[] memory p, uint64[] memory m)
    {
        t = new address[](2);
        p = new uint256[](2);
        m = new uint64[](2);
        t[0] = address(nvda);
        t[1] = address(tsla);
        p[0] = pN;
        p[1] = pT;
        m[0] = at - 60;
        m[1] = at - 60;
    }

    function _sign(uint256 pk, bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, MessageHashUtils.toEthSignedMessageHash(d));
        return abi.encodePacked(r, s, v);
    }

    function _push(uint256 pN, uint256 pT, uint64 at) internal {
        (address[] memory t, uint256[] memory p, uint64[] memory m) = _report(pN, pT, at);
        oracle.submit(t, p, m, at, _sign(signerPk, oracle.digest(t, p, m, at)));
    }

    function _lockNvda(uint256 amt) internal {
        vm.startPrank(alice);
        nvda.approve(address(credit), type(uint256).max);
        credit.lock(address(nvda), amt);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ oracle

    function test_oracle_storesSignedReport() public view {
        (uint256 p, uint256 mt, uint256 at) = oracle.price(address(nvda));
        assertEq(p, 200e8);
        assertEq(at, block.timestamp);
        assertEq(mt, block.timestamp - 60);
    }

    function test_oracle_rejectsWrongSigner() public {
        uint64 at = uint64(block.timestamp + 1);
        (address[] memory t, uint256[] memory p, uint64[] memory m) = _report(1e8, 1e8, at);
        bytes memory sig = _sign(0xBAD, oracle.digest(t, p, m, at));
        vm.expectRevert(NorenStockOracle.BadSignature.selector);
        oracle.submit(t, p, m, at, sig);
    }

    function test_oracle_rejectsTamperedPrice() public {
        uint64 at = uint64(block.timestamp + 1);
        (address[] memory t, uint256[] memory p, uint64[] memory m) = _report(201e8, 400e8, at);
        bytes memory sig = _sign(signerPk, oracle.digest(t, p, m, at));
        p[0] = 1e8; // a submitter lowers NVDA after signing
        vm.expectRevert(NorenStockOracle.BadSignature.selector);
        oracle.submit(t, p, m, at, sig);
    }

    function test_oracle_rejectsReplayAndOlder() public {
        uint64 at = uint64(block.timestamp);
        (address[] memory t, uint256[] memory p, uint64[] memory m) = _report(200e8, 400e8, at);
        bytes memory sig = _sign(signerPk, oracle.digest(t, p, m, at));
        vm.expectRevert(abi.encodeWithSelector(NorenStockOracle.OldReport.selector, at, at));
        oracle.submit(t, p, m, at, sig);
    }

    function test_oracle_rejectsFuture() public {
        uint64 at = uint64(block.timestamp + 600);
        (address[] memory t, uint256[] memory p, uint64[] memory m) = _report(200e8, 400e8, at);
        bytes memory sig = _sign(signerPk, oracle.digest(t, p, m, at));
        vm.expectRevert(abi.encodeWithSelector(NorenStockOracle.FutureReport.selector, at));
        oracle.submit(t, p, m, at, sig);
    }

    function test_oracle_reportForAnotherOracleFails() public {
        NorenStockOracle other = new NorenStockOracle(owner, signer, 3600, "x");
        vm.prank(owner);
        other.list(address(nvda), "NVDA");
        uint64 at = uint64(block.timestamp + 1);
        (address[] memory t, uint256[] memory p, uint64[] memory m) = _report(200e8, 400e8, at);
        bytes memory sig = _sign(signerPk, oracle.digest(t, p, m, at));
        vm.prank(owner);
        other.list(address(tsla), "TSLA");
        vm.expectRevert(NorenStockOracle.BadSignature.selector);
        other.submit(t, p, m, at, sig);
    }

    function test_oracle_staleRead() public {
        vm.warp(block.timestamp + 3601);
        vm.expectRevert();
        oracle.price(address(nvda));
        (,,, bool fresh) = oracle.last(address(nvda));
        assertFalse(fresh);
    }

    function test_oracle_unknownToken() public {
        vm.expectRevert(abi.encodeWithSelector(NorenStockOracle.UnknownToken.selector, address(usdc)));
        oracle.price(address(usdc));
    }

    // ------------------------------------------------------------------ desk

    function test_desk_sellAtPriceMinusSpread() public {
        vm.startPrank(alice);
        nvda.approve(address(desk), type(uint256).max);
        uint256 before = usdc.balanceOf(bob);
        uint256 out = desk.sell(address(nvda), 1e18, 0, bob);
        vm.stopPrank();
        assertEq(out, 199e6); // 200 * (1 - 0.5%)
        assertEq(usdc.balanceOf(bob) - before, 199e6);
        assertEq(nvda.balanceOf(address(desk)), 11e18);
    }

    function test_desk_quoteSellInCoversExactAmount() public {
        (uint256 inAmt,) = desk.quoteSellIn(address(nvda), 148e6);
        vm.startPrank(alice);
        nvda.approve(address(desk), type(uint256).max);
        uint256 out = desk.sell(address(nvda), inAmt, 148e6, alice);
        vm.stopPrank();
        assertGe(out, 148e6);
        assertLe(out, 148e6 + 1);
    }

    function test_desk_slippage() public {
        vm.startPrank(alice);
        nvda.approve(address(desk), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(NorenStockDesk.Slippage.selector, 199e6, 200e6));
        desk.sell(address(nvda), 1e18, 200e6, alice);
        vm.stopPrank();
    }

    function test_desk_refusesStalePrice() public {
        vm.warp(block.timestamp + 3601);
        vm.startPrank(alice);
        nvda.approve(address(desk), type(uint256).max);
        vm.expectRevert();
        desk.sell(address(nvda), 1e18, 0, alice);
        vm.stopPrank();
    }

    function test_desk_buy() public {
        vm.startPrank(alice);
        usdc.approve(address(desk), type(uint256).max);
        uint256 out = desk.buy(address(nvda), 201e6, 0, alice);
        vm.stopPrank();
        assertEq(out, 1e18); // 201 / (200 * 1.005)
    }

    // ------------------------------------------------------------------ credit

    function test_credit_limitIs60PctOfStock() public {
        _lockNvda(2e18); // $400
        assertEq(credit.collateralValue(alice), 400e6);
        assertEq(credit.creditLimit(alice), 240e6);
    }

    function test_credit_payIn3_onTime_raisesLtv() public {
        _lockNvda(2e18);
        vm.prank(alice);
        uint256 id = credit.openPlan(150e6, 3, bytes32("AUB-1"), alice);
        assertEq(usdc.balanceOf(alice), 1_150e6);
        assertEq(credit.owed(alice), 151.5e6);
        assertEq(credit.nextInstallment(id), 50.5e6);

        vm.startPrank(alice);
        usdc.approve(address(credit), type(uint256).max);
        credit.payInstallment(id);
        assertEq(credit.ltvBps(alice), 6_500);
        assertEq(credit.creditLimit(alice), 260e6);
        credit.payInstallment(id);
        credit.payInstallment(id);
        vm.stopPrank();
        assertEq(credit.owed(alice), 0);
        assertEq(credit.ltvBps(alice), 7_500);
        assertTrue(credit.plan(id).closed);
        vm.expectRevert(NorenStockCredit.PlanDone.selector);
        credit.payInstallment(id);
    }

    function test_credit_ltvCapsAt75() public {
        _lockNvda(5e18);
        vm.startPrank(alice);
        usdc.approve(address(credit), type(uint256).max);
        for (uint256 i; i < 3; i++) {
            uint256 id = credit.openPlan(10e6, 3, bytes32(0), alice);
            credit.payInstallment(id);
            credit.payInstallment(id);
            credit.payInstallment(id);
        }
        vm.stopPrank();
        assertEq(credit.onTimeOf(alice), 9);
        assertEq(credit.ltvBps(alice), 7_500);
    }

    function test_credit_lateInstallmentDoesNotRaise() public {
        _lockNvda(2e18);
        vm.prank(alice);
        uint256 id = credit.openPlan(100e6, 3, bytes32(0), alice);
        vm.warp(block.timestamp + 14 days + 3 days + 1);
        _push(200e8, 400e8, uint64(block.timestamp));
        vm.startPrank(alice);
        usdc.approve(address(credit), type(uint256).max);
        credit.payInstallment(id);
        vm.stopPrank();
        assertEq(credit.onTimeOf(alice), 0);
        assertEq(credit.lateOf(alice), 1);
        assertEq(credit.ltvBps(alice), 6_000);
    }

    function test_credit_overLimit() public {
        _lockNvda(1e18); // $200 -> limit 120
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NorenStockCredit.OverLimit.selector, 121.2e6, 120e6));
        credit.openPlan(120e6, 3, bytes32(0), alice);
    }

    function test_credit_refusesStalePrice() public {
        _lockNvda(2e18);
        vm.warp(block.timestamp + 3601);
        vm.prank(alice);
        vm.expectRevert();
        credit.openPlan(10e6, 1, bytes32(0), alice);
    }

    function test_credit_badParts() public {
        _lockNvda(2e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NorenStockCredit.BadParts.selector, 2));
        credit.openPlan(10e6, 2, bytes32(0), alice);
    }

    function test_credit_payLaterSinglePayment() public {
        _lockNvda(2e18);
        vm.prank(alice);
        uint256 id = credit.openPlan(50e6, 1, bytes32(0), alice);
        assertEq(credit.dueAt(id, 0), block.timestamp + 30 days);
        assertEq(credit.nextInstallment(id), 50.5e6);
        vm.startPrank(alice);
        usdc.approve(address(credit), type(uint256).max);
        credit.payInstallment(id);
        vm.stopPrank();
        assertEq(credit.owed(alice), 0);
        assertTrue(credit.plan(id).closed);
    }

    function test_credit_unlockBlockedWhileOwed() public {
        _lockNvda(2e18);
        vm.startPrank(alice);
        credit.openPlan(200e6, 1, bytes32(0), alice); // owed 202 of a 240 limit
        vm.expectRevert();
        credit.unlock(address(nvda), 1e18);
        vm.stopPrank();
    }

    function test_credit_unlockWhenClear() public {
        _lockNvda(2e18);
        vm.warp(block.timestamp + 2 hours); // stale price is fine with no debt
        vm.prank(alice);
        credit.unlock(address(nvda), 2e18);
        assertEq(nvda.balanceOf(alice), 10e18);
    }

    function test_credit_onlyListed() public {
        vm.startPrank(alice);
        usdc.approve(address(credit), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(NorenStockCredit.UnknownAsset.selector, address(usdc)));
        credit.lock(address(usdc), 1e6);
        vm.stopPrank();
    }

    function test_credit_liquidationAfterPriceDrop() public {
        _lockNvda(2e18);
        vm.prank(alice);
        credit.openPlan(230e6, 1, bytes32(0), alice); // owed 232.3
        vm.startPrank(liq);
        usdc.approve(address(credit), type(uint256).max);
        vm.expectRevert();
        credit.liquidate(alice, address(nvda), 100e6);
        vm.stopPrank();

        _push(130e8, 400e8, uint64(block.timestamp + 1)); // collateral $260, liquidation value $221 < 232.3
        vm.warp(block.timestamp + 1);
        vm.prank(liq);
        uint256 seized = credit.liquidate(alice, address(nvda), 100e6);
        // 100 * 1.05 / 130 = 0.8077 NVDA
        assertApproxEqAbs(seized, 807692307692307692, 1);
        assertEq(credit.owed(alice), 132.3e6);
        assertEq(nvda.balanceOf(liq), seized);
    }

    function test_credit_liquidationCloseFactor() public {
        _lockNvda(2e18);
        vm.prank(alice);
        credit.openPlan(230e6, 1, bytes32(0), alice);
        _push(100e8, 400e8, uint64(block.timestamp + 1));
        vm.warp(block.timestamp + 1);
        vm.startPrank(liq);
        usdc.approve(address(credit), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(NorenStockCredit.TooMuch.selector, 116.15e6));
        credit.liquidate(alice, address(nvda), 200e6);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ Earn pool

    function test_pool_feesRaiseShareValue() public {
        _lockNvda(2e18);
        vm.startPrank(alice);
        uint256 id = credit.openPlan(150e6, 3, bytes32(0), alice);
        usdc.approve(address(credit), type(uint256).max);
        credit.payInstallment(id);
        credit.payInstallment(id);
        credit.payInstallment(id);
        vm.stopPrank();
        assertEq(credit.feesEarned(), 1.5e6);
        assertEq(credit.valueOf(lender), 5_001.5e6);
        uint256 sh = credit.sharesOf(lender);
        vm.prank(lender);
        uint256 got = credit.withdraw(sh);
        assertEq(got, 5_001.5e6);
    }

    function test_pool_secondSupplierGetsFairShares() public {
        _lockNvda(2e18);
        vm.startPrank(alice);
        uint256 id = credit.openPlan(100e6, 1, bytes32(0), alice);
        usdc.approve(address(credit), type(uint256).max);
        credit.payInstallment(id); // +1.00 fee
        uint256 s = credit.supply(500e6);
        vm.stopPrank();
        assertApproxEqAbs(credit.valueOf(alice), 500e6, 1);
        assertLt(s, 500e6);
    }

    function test_pool_withdrawBlockedWhenLentOut() public {
        _lockNvda(10e18);
        // lender's 5,000 minus 1,000 lent -> lender cannot take all 5,000 in cash
        vm.prank(alice);
        credit.openPlan(1_000e6, 1, bytes32(0), alice);
        uint256 sh = credit.sharesOf(lender);
        vm.prank(lender);
        vm.expectRevert(abi.encodeWithSelector(NorenStockCredit.PoolShort.selector, 4_000e6, 5_000e6));
        credit.withdraw(sh);
    }

    // ------------------------------------------------------------------ starter

    function test_starter_oncePerAddress() public {
        address[] memory t = new address[](2);
        uint256[] memory a = new uint256[](2);
        t[0] = address(nvda);
        t[1] = address(tsla);
        a[0] = 2e18;
        a[1] = 1e18;
        NorenStockStarter st = new NorenStockStarter(owner, t, a);
        vm.startPrank(owner);
        nvda.mint(address(st), 4e18);
        tsla.mint(address(st), 2e18);
        vm.stopPrank();
        assertEq(st.packsLeft(), 2);
        vm.prank(bob);
        st.claim();
        assertEq(nvda.balanceOf(bob), 2e18);
        vm.prank(bob);
        vm.expectRevert(NorenStockStarter.AlreadyClaimed.selector);
        st.claim();
    }
}
