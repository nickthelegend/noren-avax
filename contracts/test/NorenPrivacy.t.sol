// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NorenCredit} from "../src/NorenCredit.sol";
import {NorenMerchants} from "../src/NorenMerchants.sol";
import {NorenTestToken} from "../src/NorenTestToken.sol";
import {EncryptedERC} from "../src/vendor/eerc/EncryptedERC.sol";
import {Registrar} from "../src/vendor/eerc/Registrar.sol";
import {IRegistrar} from "../src/vendor/eerc/interfaces/IRegistrar.sol";
import {RegistrationVerifier} from "../src/vendor/eerc/prod/RegistrationVerifier.sol";
import {MintVerifier} from "../src/vendor/eerc/prod/MintVerifier.sol";
import {WithdrawVerifier} from "../src/vendor/eerc/prod/WithdrawVerifier.sol";
import {TransferVerifier} from "../src/vendor/eerc/prod/TransferVerifier.sol";
import {BurnVerifier} from "../src/vendor/eerc/prod/BurnVerifier.sol";
import {BabyJubJub} from "../src/vendor/eerc/libraries/BabyJubJub.sol";
import {CreateEncryptedERCParams, EGCT, Point, AmountPCT} from "../src/vendor/eerc/types/Types.sol";
import {LocalFeed} from "./utils/LocalFeed.sol";

/// The eERC privacy path in Foundry, against Ava Labs' production Groth16 verifiers. The proofs are the ones
/// the official SDK produced in scripts/anvil/privacy.test.ts (fixtures/eerc-anvil.json, chain 31337, same
/// addresses as makeAddr); eERC deposits encrypt with fixed randomness, so replaying the same sequence
/// rebuilds the exact ciphertexts each proof was made against. Decryption checks run ElGamal on chain data
/// with the merchant's scalar: c2 - sk * c1 must equal amount * Base8.
contract NorenPrivacyTest is Test {
    string fx;
    NorenTestToken usdc;
    NorenTestToken wbtc;
    Registrar registrar;
    EncryptedERC eerc;
    NorenMerchants merchants;
    NorenCredit credit;

    address customer = makeAddr("customer");
    address merchant = makeAddr("merchant");
    address auditor = makeAddr("auditor");
    address stranger = makeAddr("stranger");

    function setUp() public {
        fx = vm.readFile("test/fixtures/eerc-anvil.json");
        assertEq(vm.parseJsonAddress(fx, ".customer"), customer);
        assertEq(vm.parseJsonAddress(fx, ".merchant"), merchant);
        assertEq(vm.parseJsonAddress(fx, ".auditor"), auditor);

        usdc = new NorenTestToken("Noren Test USDC", "tUSDC", 6, 250e6, address(this));
        wbtc = new NorenTestToken("Noren Test WBTC", "tWBTC", 8, 0.01e8, address(this));
        registrar = new Registrar(address(new RegistrationVerifier()));
        eerc = new EncryptedERC(
            CreateEncryptedERCParams({
                registrar: address(registrar),
                isConverter: true,
                name: "",
                symbol: "",
                decimals: 2,
                mintVerifier: address(new MintVerifier()),
                withdrawVerifier: address(new WithdrawVerifier()),
                transferVerifier: address(new TransferVerifier()),
                burnVerifier: address(new BurnVerifier())
            })
        );
        merchants = new NorenMerchants(IRegistrar(address(registrar)));
        credit = new NorenCredit(usdc, 600, address(this));
        credit.listAsset(address(wbtc), new LocalFeed(73_000e8), 6_000, 7_500, 500, 25 hours);
        usdc.mint(address(this), 10_000e6);
        usdc.approve(address(credit), type(uint256).max);
        credit.fund(10_000e6);
    }

    // ------------------------------------------------------------------ helpers

    function _sk(string memory who) internal view returns (uint256) {
        return vm.parseUint(vm.parseJsonString(fx, string.concat(".sk.", who)));
    }

    function _call(address from, address to, bytes memory data) internal returns (bool ok, bytes memory ret) {
        vm.prank(from);
        (ok, ret) = to.call(data);
    }

    function _register(string memory who, address user) internal {
        (bool ok,) = _call(user, address(registrar), vm.parseJsonBytes(fx, string.concat(".registrations.", who)));
        assertTrue(ok, string.concat("register ", who));
    }

    function _deposit(uint256 i) internal {
        string memory k = string.concat(".deposits[", vm.toString(i), "]");
        uint256 amount = vm.parseUint(vm.parseJsonString(fx, string.concat(k, ".amount")));
        string[] memory s = vm.parseJsonStringArray(fx, string.concat(k, ".amountPCT"));
        uint256[7] memory pct;
        for (uint256 j; j < 7; ++j) pct[j] = vm.parseUint(s[j]);
        vm.startPrank(customer);
        usdc.approve(address(eerc), amount);
        eerc.deposit(amount, address(usdc), pct);
        vm.stopPrank();
    }

    function _transferData(uint256 i) internal view returns (bytes memory) {
        return vm.parseJsonBytes(fx, string.concat(".transfers[", vm.toString(i), "]"));
    }

    function _balance(address user) internal view returns (EGCT memory e) {
        (e,,,,) = eerc.getBalanceFromTokenAddress(user, address(usdc));
    }

    /// ElGamal on BabyJubJub: c2 - sk * c1 = m * Base8.
    function _decryptsTo(EGCT memory e, uint256 sk, uint256 amount) internal view returns (bool) {
        Point memory m = BabyJubJub._sub(e.c2, BabyJubJub.scalarMultiply(e.c1, sk));
        Point memory want = BabyJubJub.scalarMultiply(BabyJubJub.base8(), amount);
        return m.x == want.x && m.y == want.y;
    }

    function _setup() internal {
        _register("customer", customer);
        _register("merchant", merchant);
        _register("auditor", auditor);
        eerc.setAuditorPublicKey(auditor);
        usdc.mint(customer, 250e6);
        _deposit(0);
    }

    // ------------------------------------------------------------------ registration

    function test_registrationProofsVerifyAndBindTheSender() public {
        // The customer's proof sent by someone else fails: the address is a public input.
        (bool ok,) = _call(stranger, address(registrar), vm.parseJsonBytes(fx, ".registrations.customer"));
        assertFalse(ok);
        _register("customer", customer);
        assertTrue(registrar.isUserRegistered(customer));
        assertFalse(registrar.isUserRegistered(stranger));
        // A registration can't be replayed.
        (ok,) = _call(customer, address(registrar), vm.parseJsonBytes(fx, ".registrations.customer"));
        assertFalse(ok);
    }

    function test_shopsOpenOnlyForRegisteredOwners() public {
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(NorenMerchants.NotRegistered.selector, merchant));
        merchants.openShop("Kinari Studio", "kinari");
        _register("merchant", merchant);
        vm.startPrank(merchant);
        uint256 id = merchants.openShop("Kinari Studio", "kinari");
        merchants.listItem(id, "Linen tote", 2400);
        vm.expectRevert(abi.encodeWithSelector(NorenMerchants.SlugTaken.selector, "kinari"));
        merchants.openShop("Copycat", "kinari");
        vm.expectRevert(NorenMerchants.BadSlug.selector);
        merchants.openShop("Bad", "Bad Slug");
        vm.stopPrank();
        vm.prank(stranger);
        vm.expectRevert(NorenMerchants.NotShopOwner.selector);
        merchants.listItem(id, "Fake", 1);
        assertEq(merchants.items(id)[0].priceCents, 2400);
        (uint256 sid,) = merchants.shopBySlug("kinari");
        assertEq(sid, id);
    }

    // ------------------------------------------------------------------ pay

    function test_pay_amountIsNotReadableOnChain_merchantDecrypts() public {
        _setup();
        uint256 lockedBefore = usdc.balanceOf(address(eerc));
        assertEq(lockedBefore, 100e6);

        vm.recordLogs();
        (bool ok,) = _call(customer, address(eerc), _transferData(0));
        assertTrue(ok, "private payment");
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // No ERC20 moved and the contract's public tUSDC is unchanged.
        bytes32 erc20Transfer = keccak256("Transfer(address,address,uint256)");
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != erc20Transfer, "a public token transfer happened");
            // The amount (2400 cents / 24 tUSDC) is in no log word.
            bytes memory data = logs[i].data;
            for (uint256 o; o + 32 <= data.length; o += 32) {
                uint256 w;
                assembly { w := mload(add(add(data, 32), o)) }
                assertTrue(w != 2400 && w != 24e6, "plaintext amount in a log");
            }
        }
        assertEq(usdc.balanceOf(address(eerc)), lockedBefore);

        // What's stored for the merchant is a ciphertext, not 2400 ...
        EGCT memory m = _balance(merchant);
        assertTrue(m.c2.x != 2400 && m.c2.y != 2400);
        // ... that the merchant's key opens to exactly 2400 cents,
        assertTrue(_decryptsTo(m, _sk("merchant"), 2400), "merchant decrypts 24.00");
        // and that the customer's or auditor's key does not.
        assertFalse(_decryptsTo(m, _sk("customer"), 2400));
        assertFalse(_decryptsTo(m, _sk("auditor"), 2400));
        // The customer's balance is 10,000 - 2,400 under the customer's key.
        assertTrue(_decryptsTo(_balance(customer), _sk("customer"), 7600));
    }

    function test_pay_emitsTheAuditorCiphertextToTheAuditor() public {
        _setup();
        vm.recordLogs();
        _call(customer, address(eerc), _transferData(0));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("PrivateTransfer(address,address,uint256[7],address)");
        bool seen;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != sig) continue;
            seen = true;
            assertEq(address(uint160(uint256(logs[i].topics[1]))), customer);
            assertEq(address(uint160(uint256(logs[i].topics[2]))), merchant);
            assertEq(address(uint160(uint256(logs[i].topics[3]))), auditor);
            uint256[7] memory pct = abi.decode(logs[i].data, (uint256[7]));
            for (uint256 j; j < 7; ++j) assertTrue(pct[j] != 2400);
        }
        assertTrue(seen);
        // The Poseidon decryption of this auditor PCT to 2400 is asserted in scripts/anvil/privacy.test.ts.
    }

    function test_pay_tamperedProofRejected() public {
        _setup();
        bytes memory data = _transferData(0);
        // Flip one byte inside the receiver ciphertext public signal (selector + to + tokenId + proof points...).
        data[4 + 32 * 2 + 32 * 8 + 32 * 14 + 31] ^= 0x01;
        (bool ok, bytes memory ret) = _call(customer, address(eerc), data);
        assertFalse(ok);
        assertTrue(ret.length >= 4);
        assertTrue(_decryptsTo(_balance(customer), _sk("customer"), 10_000), "balance untouched");
    }

    function test_pay_proofCannotBeReplayedOrStolen() public {
        _setup();
        bytes memory data = _transferData(0);
        (bool ok,) = _call(stranger, address(eerc), data);
        assertFalse(ok, "someone else submitting the customer's proof");
        (ok,) = _call(auditor, address(eerc), data);
        assertFalse(ok, "a registered user submitting the customer's proof");
        (ok,) = _call(customer, address(eerc), data);
        assertTrue(ok);
        (ok,) = _call(customer, address(eerc), data);
        assertFalse(ok, "replay after the balance changed");
    }

    function test_pay_toUnregisteredShopRefused() public {
        _setup();
        // Re-point the customer's payment at an unregistered address.
        bytes memory data = _transferData(0);
        address s = stranger;
        assembly { mstore(add(data, 36), s) }
        (bool ok,) = _call(customer, address(eerc), data);
        assertFalse(ok);
    }

    // ------------------------------------------------------------------ borrow and pay, withdraw

    function test_borrowAndPay_thenMerchantWithdraws() public {
        _setup();
        (bool ok,) = _call(customer, address(eerc), _transferData(0));
        assertTrue(ok);

        // Credit: 0.01 tWBTC at $73,000 -> borrow 36 tUSDC, shield it, pay 36.00 privately.
        wbtc.mint(customer, 0.01e8);
        vm.startPrank(customer);
        wbtc.approve(address(credit), 0.01e8);
        credit.depositCollateral(address(wbtc), 0.01e8);
        credit.borrow(36e6, customer);
        vm.stopPrank();
        assertEq(usdc.balanceOf(customer), 250e6 - 100e6 + 36e6);
        _deposit(1);
        (ok,) = _call(customer, address(eerc), _transferData(1));
        assertTrue(ok, "credit-funded private payment");
        assertTrue(_decryptsTo(_balance(merchant), _sk("merchant"), 6000), "merchant decrypts 60.00");
        assertTrue(_decryptsTo(_balance(customer), _sk("customer"), 7600));
        assertEq(credit.debtOf(customer), 36e6);

        // The merchant turns private revenue into public tUSDC.
        uint256 before = usdc.balanceOf(merchant);
        (ok,) = _call(merchant, address(eerc), vm.parseJsonBytes(fx, ".withdraw"));
        assertTrue(ok, "withdraw");
        assertEq(usdc.balanceOf(merchant) - before, 60e6);
        assertTrue(_decryptsTo(_balance(merchant), _sk("merchant"), 0));

        // And the customer repays the line.
        usdc.mint(customer, 1e6);
        vm.startPrank(customer);
        usdc.approve(address(credit), type(uint256).max);
        credit.repay(customer, type(uint256).max);
        vm.stopPrank();
        assertEq(credit.debtOf(customer), 0);
    }

    function test_withdrawProofOnlyWorksForItsOwner() public {
        _setup();
        _call(customer, address(eerc), _transferData(0));
        (bool ok,) = _call(customer, address(eerc), vm.parseJsonBytes(fx, ".withdraw"));
        assertFalse(ok, "the customer can't use the merchant's withdraw proof");
    }
}
