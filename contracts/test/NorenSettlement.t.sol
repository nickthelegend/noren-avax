// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test, Vm} from "forge-std/Test.sol";
import {NorenMerchants} from "../src/NorenMerchants.sol";
import {NorenSettlement} from "../src/NorenSettlement.sol";
import {Registrar} from "../src/vendor/eerc/Registrar.sol";
import {IRegistrar} from "../src/vendor/eerc/interfaces/IRegistrar.sol";
import {RegistrationVerifier} from "../src/vendor/eerc/prod/RegistrationVerifier.sol";

/// The settlement record, against Ava Labs' real Registrar and production registration verifier. The eERC keys are
/// registered with the SDK proofs recorded in fixtures/eerc-anvil.json (same addresses as makeAddr). Here the hub is
/// the fixture's "customer" key, the shop owner is "merchant" and the accountant is "auditor": any registered keys.
contract NorenSettlementTest is Test {
    string fx;
    Registrar registrar;
    NorenMerchants merchants;
    NorenSettlement settlement;

    address hub = makeAddr("customer");
    address shopOwner = makeAddr("merchant");
    address accountant = makeAddr("auditor");
    address stranger = makeAddr("stranger");
    address eerc = makeAddr("eerc");
    uint256 shopA;
    uint256 shopB;

    function setUp() public {
        fx = vm.readFile("test/fixtures/eerc-anvil.json");
        registrar = new Registrar(address(new RegistrationVerifier()));
        _register("customer", hub);
        _register("merchant", shopOwner);
        _register("auditor", accountant);
        merchants = new NorenMerchants(IRegistrar(address(registrar)));
        vm.startPrank(shopOwner);
        shopA = merchants.openShop("Harbor & Loom", "harbor-loom");
        shopB = merchants.openShop("Kiln Row", "kiln-row");
        vm.stopPrank();
        settlement = new NorenSettlement(merchants, IRegistrar(address(registrar)), eerc, hub);
    }

    function _register(string memory who, address user) internal {
        vm.prank(user);
        (bool ok,) = address(registrar).call(vm.parseJsonBytes(fx, string.concat(".registrations.", who)));
        assertTrue(ok, string.concat("register ", who));
    }

    function _payout(uint256 shopId, string memory tag, bytes memory forAccountant)
        internal
        pure
        returns (NorenSettlement.Payout memory)
    {
        return NorenSettlement.Payout({
            shopId: shopId,
            payoutTx: keccak256(abi.encode("payout", tag)),
            digest: keccak256(abi.encode("statement", tag)),
            forAccountant: forAccountant
        });
    }

    function _one(bytes32 a) internal pure returns (bytes32[] memory r) {
        r = new bytes32[](1);
        r[0] = a;
    }

    function _none() internal pure returns (bytes32[] memory r) {}

    function _payouts2(string memory t) internal view returns (NorenSettlement.Payout[] memory p) {
        p = new NorenSettlement.Payout[](2);
        p[0] = _payout(shopA, string.concat(t, "a"), "");
        p[1] = _payout(shopB, string.concat(t, "b"), ""); // a cover payout looks the same
    }

    // ---------------------------------------------------------------- happy path

    function test_hubSettlesABatchAndEveryPartIsRecorded() public {
        bytes32[] memory pays = new bytes32[](2);
        pays[0] = keccak256("pay1");
        pays[1] = keccak256("pay2");
        NorenSettlement.Payout[] memory p = _payouts2("1");
        vm.recordLogs();
        vm.prank(hub);
        uint256 id = settlement.settle(pays, p, _none(), hex"c0ffee");
        assertEq(id, 0);
        assertEq(settlement.batchCount(), 1);
        assertEq(settlement.settledIn(pays[0]), 1);
        assertEq(settlement.settledIn(pays[1]), 1);
        assertTrue(settlement.payoutRecorded(p[0].payoutTx));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 3); // two ShopPayout, one BatchSettled
        assertEq(logs[2].topics[0], NorenSettlement.BatchSettled.selector);
        (uint64 at, bytes32[] memory gotPays, bytes32[] memory txs,, bytes memory aud) =
            abi.decode(logs[2].data, (uint64, bytes32[], bytes32[], bytes32[], bytes));
        assertEq(at, block.timestamp);
        assertEq(gotPays.length, 2);
        assertEq(txs[1], p[1].payoutTx);
        assertEq(aud, hex"c0ffee");
    }

    function test_batchIdsCount() public {
        vm.startPrank(hub);
        settlement.settle(_one(keccak256("p1")), _payouts2("1"), _none(), "");
        uint256 id = settlement.settle(_one(keccak256("p2")), _payouts2("2"), _none(), "");
        vm.stopPrank();
        assertEq(id, 1);
        assertEq(settlement.settledIn(keccak256("p2")), 2);
    }

    function test_refundOnlyBatchIsAllowed() public {
        vm.prank(hub);
        settlement.settle(_one(keccak256("bad-note")), new NorenSettlement.Payout[](0), _one(keccak256("refund")), "");
        assertTrue(settlement.payoutRecorded(keccak256("refund")));
    }

    // ---------------------------------------------------------------- who may write

    function test_onlyTheHubSettles() public {
        NorenSettlement.Payout[] memory p = _payouts2("1");
        for (uint256 i; i < 3; ++i) {
            address who = [stranger, shopOwner, accountant][i];
            vm.prank(who);
            vm.expectRevert(NorenSettlement.NotHub.selector);
            settlement.settle(_one(keccak256("p")), p, _none(), "");
        }
    }

    function test_onlyOwnerRotatesTheHubAndOldHubLosesAccess() public {
        vm.prank(stranger);
        vm.expectRevert(NorenSettlement.NotOwner.selector);
        settlement.setHub(stranger);
        vm.expectRevert(abi.encodeWithSelector(NorenSettlement.NotRegistered.selector, stranger));
        settlement.setHub(stranger); // the hub needs an eERC key: customers pay it privately
        settlement.setHub(shopOwner);
        vm.prank(hub);
        vm.expectRevert(NorenSettlement.NotHub.selector);
        settlement.settle(_one(keccak256("p")), _payouts2("1"), _none(), "");
    }

    function test_constructorRefusesAnUnregisteredHub() public {
        vm.expectRevert(abi.encodeWithSelector(NorenSettlement.NotRegistered.selector, stranger));
        new NorenSettlement(merchants, IRegistrar(address(registrar)), eerc, stranger);
    }

    // ---------------------------------------------------------------- the hub can't double count

    function test_aPaymentSettlesOnlyOnce() public {
        bytes32 pay = keccak256("pay1");
        vm.startPrank(hub);
        settlement.settle(_one(pay), _payouts2("1"), _none(), "");
        vm.expectRevert(abi.encodeWithSelector(NorenSettlement.AlreadySettled.selector, pay));
        settlement.settle(_one(pay), _payouts2("2"), _none(), "");
        vm.stopPrank();
    }

    function test_aPaymentTwiceInOneBatchIsRefused() public {
        bytes32[] memory pays = new bytes32[](2);
        pays[0] = keccak256("pay1");
        pays[1] = pays[0];
        vm.prank(hub);
        vm.expectRevert(abi.encodeWithSelector(NorenSettlement.AlreadySettled.selector, pays[0]));
        settlement.settle(pays, _payouts2("1"), _none(), "");
    }

    function test_aPayoutTxCannotBeReusedAcrossBatchesOrAsARefund() public {
        NorenSettlement.Payout[] memory p = _payouts2("1");
        vm.startPrank(hub);
        settlement.settle(_one(keccak256("p1")), p, _none(), "");
        NorenSettlement.Payout[] memory again = new NorenSettlement.Payout[](1);
        again[0] = p[0];
        vm.expectRevert(abi.encodeWithSelector(NorenSettlement.PayoutReused.selector, p[0].payoutTx));
        settlement.settle(_one(keccak256("p2")), again, _none(), "");
        vm.expectRevert(abi.encodeWithSelector(NorenSettlement.PayoutReused.selector, p[1].payoutTx));
        settlement.settle(_one(keccak256("p3")), new NorenSettlement.Payout[](0), _one(p[1].payoutTx), "");
        vm.stopPrank();
    }

    function test_oneShopOncePerBatch() public {
        NorenSettlement.Payout[] memory p = new NorenSettlement.Payout[](2);
        p[0] = _payout(shopA, "x", "");
        p[1] = _payout(shopA, "y", "");
        vm.prank(hub);
        vm.expectRevert(abi.encodeWithSelector(NorenSettlement.DuplicateShop.selector, shopA));
        settlement.settle(_one(keccak256("p")), p, _none(), "");
    }

    function test_unknownShopEmptyBatchAndZeroHashesAreRefused() public {
        NorenSettlement.Payout[] memory p = new NorenSettlement.Payout[](1);
        p[0] = _payout(99, "x", "");
        vm.startPrank(hub);
        vm.expectRevert(abi.encodeWithSelector(NorenMerchants.UnknownShop.selector, 99));
        settlement.settle(_one(keccak256("p")), p, _none(), "");
        vm.expectRevert(NorenSettlement.EmptyBatch.selector);
        settlement.settle(_one(keccak256("p")), new NorenSettlement.Payout[](0), _none(), "");
        vm.expectRevert(NorenSettlement.BadHash.selector);
        settlement.settle(_one(bytes32(0)), _payouts2("1"), _none(), "");
        p[0] = _payout(shopA, "x", "");
        p[0].digest = bytes32(0);
        vm.expectRevert(NorenSettlement.BadHash.selector);
        settlement.settle(_one(keccak256("p")), p, _none(), "");
        vm.stopPrank();
    }

    function test_atMost32PayoutsPerBatch() public {
        NorenSettlement.Payout[] memory p = new NorenSettlement.Payout[](33);
        vm.prank(hub);
        vm.expectRevert(NorenSettlement.TooManyPayouts.selector);
        settlement.settle(_one(keccak256("p")), p, _none(), "");
    }

    // ---------------------------------------------------------------- per-shop accountants

    function test_shopOwnerNamesAnAccountantAndStatementsBecomeRequired() public {
        vm.prank(shopOwner);
        settlement.setAccountant(shopA, accountant);
        assertEq(settlement.accountantOf(shopA), accountant);
        assertEq(settlement.accountantOf(shopB), address(0));

        vm.prank(hub);
        vm.expectRevert(abi.encodeWithSelector(NorenSettlement.MissingStatement.selector, shopA));
        settlement.settle(_one(keccak256("p")), _payouts2("1"), _none(), "");

        NorenSettlement.Payout[] memory p = _payouts2("1");
        p[0].forAccountant = hex"0102";
        vm.recordLogs();
        vm.prank(hub);
        settlement.settle(_one(keccak256("p")), p, _none(), "");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs[0].topics[0], NorenSettlement.ShopPayout.selector);
        assertEq(uint256(logs[0].topics[2]), shopA);
        (,, address acct, bytes memory blob) = abi.decode(logs[0].data, (bytes32, bytes32, address, bytes));
        assertEq(acct, accountant);
        assertEq(blob, hex"0102");
    }

    function test_onlyTheShopOwnerSetsTheAccountant() public {
        vm.prank(stranger);
        vm.expectRevert(NorenSettlement.NotShopOwner.selector);
        settlement.setAccountant(shopA, accountant);
        vm.prank(hub);
        vm.expectRevert(NorenSettlement.NotShopOwner.selector);
        settlement.setAccountant(shopA, hub);
    }

    function test_accountantNeedsAnEerCKeyAndCanBeRemoved() public {
        vm.startPrank(shopOwner);
        vm.expectRevert(abi.encodeWithSelector(NorenSettlement.NotRegistered.selector, stranger));
        settlement.setAccountant(shopA, stranger);
        settlement.setAccountant(shopA, accountant);
        settlement.setAccountant(shopA, address(0));
        vm.stopPrank();
        assertEq(settlement.accountantOf(shopA), address(0));
    }

    // ---------------------------------------------------------------- fuzz

    function testFuzz_settledPaymentsStaySettled(bytes32 a, bytes32 b) public {
        vm.assume(a != bytes32(0) && b != bytes32(0) && a != b);
        vm.startPrank(hub);
        settlement.settle(_one(a), _payouts2("1"), _none(), "");
        settlement.settle(_one(b), _payouts2("2"), _none(), "");
        vm.expectRevert(abi.encodeWithSelector(NorenSettlement.AlreadySettled.selector, a));
        settlement.settle(_one(a), _payouts2("3"), _none(), "");
        vm.stopPrank();
        assertEq(settlement.settledIn(a), 1);
        assertEq(settlement.settledIn(b), 2);
    }
}
