// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {NorenGasStation} from "../src/NorenGasStation.sol";
import {NorenTestToken} from "../src/NorenTestToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract NorenGasStationTest is Test {
    NorenGasStation station;
    address relayer = makeAddr("relayer");
    uint256 constant DRIP = 0.0002 ether;
    bytes32 constant TAG_A = keccak256("ip-a");
    bytes32 constant TAG_B = keccak256("ip-b");
    uint256 constant USDC_PACK = 100e6;
    uint256 constant WBTC_PACK = 0.01e8;
    uint256 nextKey = 1000;
    NorenTestToken usdc;
    NorenTestToken wbtc;

    function _station() internal returns (NorenGasStation s) {
        s = new NorenGasStation(relayer, DRIP, 5, 2, IERC20(address(usdc)), USDC_PACK, IERC20(address(wbtc)), WBTC_PACK);
        vm.deal(address(s), 1 ether);
        usdc.mint(address(s), 1_000e6);
        wbtc.mint(address(s), 1e8);
    }

    function setUp() public {
        vm.warp(1_763_000_000);
        usdc = new NorenTestToken("Noren Test USDC", "tUSDC", 6, 250e6, address(this));
        wbtc = new NorenTestToken("Noren Test WBTC", "tWBTC", 8, 0.01e8, address(this));
        station = _station();
    }

    function _wallet() internal returns (address a, uint256 k) {
        k = ++nextKey;
        a = vm.addr(k);
    }

    function _sign(uint256 k, bytes32 h) internal pure returns (bytes memory) {
        bytes32 m = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(k, m);
        return abi.encodePacked(r, s, v);
    }

    function _req(uint256 k, address to) internal view returns (uint256 deadline, bytes memory sig) {
        deadline = block.timestamp + 10 minutes;
        sig = _sign(k, station.digest(to, deadline));
    }

    function _drip(address to, uint256 k, bytes32 tag) internal {
        (uint256 dl, bytes memory sig) = _req(k, to);
        vm.prank(relayer);
        station.drip(payable(to), dl, sig, tag);
    }

    // ---------------------------------------------------------------- happy path
    function test_dripPaysANewWalletOnce() public {
        (address a, uint256 k) = _wallet();
        _drip(a, k, TAG_A);
        assertEq(a.balance, DRIP);
        assertEq(usdc.balanceOf(a), USDC_PACK);
        assertEq(wbtc.balanceOf(a), WBTC_PACK);
        assertTrue(station.dripped(a));
        assertEq(station.totalDrips(), 1);
        assertEq(station.dripsOnDay(station.today()), 1);
        assertEq(station.tagOnDay(station.today(), TAG_A), 1);
        (uint256 dayLeft, uint256 tagLeft, uint256 funded) = station.room(TAG_A);
        assertEq(dayLeft, 4);
        assertEq(tagLeft, 1);
        assertEq(funded, (1_000e6 - USDC_PACK) / USDC_PACK); // tUSDC runs out first: 9 packs left
    }

    function test_dripEmitsEvent() public {
        (address a, uint256 k) = _wallet();
        (uint256 dl, bytes memory sig) = _req(k, a);
        vm.expectEmit(true, true, false, true);
        emit NorenGasStation.Dripped(a, TAG_A, DRIP, USDC_PACK, WBTC_PACK, block.timestamp / 1 days);
        vm.prank(relayer);
        station.drip(payable(a), dl, sig, TAG_A);
    }

    // ---------------------------------------------------------------- who may call
    function test_onlyRelayerCanDrip() public {
        (address a, uint256 k) = _wallet();
        (uint256 dl, bytes memory sig) = _req(k, a);
        vm.prank(a); // the wallet itself, with a valid signature, still can't pick its own tag
        vm.expectRevert(NorenGasStation.NotRelayer.selector);
        station.drip(payable(a), dl, sig, TAG_A);
    }

    // ---------------------------------------------------------------- signatures
    function test_rejectsSignatureFromAnotherKey() public {
        (address a,) = _wallet();
        (, uint256 attacker) = _wallet();
        (uint256 dl, bytes memory sig) = _req(attacker, a);
        vm.prank(relayer);
        vm.expectRevert(NorenGasStation.BadSignature.selector);
        station.drip(payable(a), dl, sig, TAG_A);
    }

    function test_rejectsSignatureMovedToAnotherWallet() public {
        (address a, uint256 k) = _wallet();
        (address b,) = _wallet();
        (uint256 dl, bytes memory sig) = _req(k, a);
        vm.prank(relayer);
        vm.expectRevert(NorenGasStation.BadSignature.selector);
        station.drip(payable(b), dl, sig, TAG_A);
    }

    function test_rejectsSignatureForAnotherStation() public {
        NorenGasStation other = _station();
        (address a, uint256 k) = _wallet();
        uint256 dl = block.timestamp + 10 minutes;
        bytes memory sig = _sign(k, other.digest(a, dl));
        vm.prank(relayer);
        vm.expectRevert(NorenGasStation.BadSignature.selector);
        station.drip(payable(a), dl, sig, TAG_A);
    }

    function test_rejectsChangedDeadline() public {
        (address a, uint256 k) = _wallet();
        (uint256 dl, bytes memory sig) = _req(k, a);
        vm.prank(relayer);
        vm.expectRevert(NorenGasStation.BadSignature.selector);
        station.drip(payable(a), dl + 1, sig, TAG_A);
    }

    function test_rejectsMalformedSignature() public {
        (address a, uint256 k) = _wallet();
        (uint256 dl, bytes memory sig) = _req(k, a);
        bytes memory short = new bytes(64);
        for (uint256 i = 0; i < 64; i++) short[i] = sig[i];
        vm.prank(relayer);
        vm.expectRevert(NorenGasStation.BadSignature.selector);
        station.drip(payable(a), dl, short, TAG_A);
    }

    function test_rejectsHighSMalleatedSignature() public {
        (address a, uint256 k) = _wallet();
        uint256 dl = block.timestamp + 10 minutes;
        bytes32 m = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", station.digest(a, dl)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(k, m);
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory flipped = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.prank(relayer);
        vm.expectRevert(NorenGasStation.BadSignature.selector);
        station.drip(payable(a), dl, flipped, TAG_A);
    }

    // ---------------------------------------------------------------- deadlines
    function test_rejectsExpiredRequest() public {
        (address a, uint256 k) = _wallet();
        (uint256 dl, bytes memory sig) = _req(k, a);
        vm.warp(dl + 1);
        vm.prank(relayer);
        vm.expectRevert(NorenGasStation.Expired.selector);
        station.drip(payable(a), dl, sig, TAG_A);
    }

    function test_rejectsFarDeadline() public {
        (address a, uint256 k) = _wallet();
        uint256 dl = block.timestamp + 2 hours;
        bytes memory sig = _sign(k, station.digest(a, dl));
        vm.prank(relayer);
        vm.expectRevert(NorenGasStation.DeadlineTooFar.selector);
        station.drip(payable(a), dl, sig, TAG_A);
    }

    // ---------------------------------------------------------------- one per wallet, new wallets only
    function test_secondDripToSameWalletReverts() public {
        (address a, uint256 k) = _wallet();
        _drip(a, k, TAG_A);
        vm.prank(a);
        payable(address(0xdead)).transfer(DRIP); // spend it all, so the balance check alone would pass
        assertEq(a.balance, 0);
        (uint256 dl, bytes memory sig) = _req(k, a);
        vm.prank(relayer);
        vm.expectRevert(NorenGasStation.AlreadyDripped.selector);
        station.drip(payable(a), dl, sig, TAG_B);
    }

    function test_walletThatHoldsAvaxIsNotNew() public {
        (address a, uint256 k) = _wallet();
        vm.deal(a, 1 wei);
        (uint256 dl, bytes memory sig) = _req(k, a);
        vm.prank(relayer);
        vm.expectRevert(NorenGasStation.NotNew.selector);
        station.drip(payable(a), dl, sig, TAG_A);
    }

    function test_addressWithCodeIsRefused() public {
        (address a, uint256 k) = _wallet();
        vm.etch(a, hex"00");
        (uint256 dl, bytes memory sig) = _req(k, a);
        vm.prank(relayer);
        vm.expectRevert(NorenGasStation.NotWallet.selector);
        station.drip(payable(a), dl, sig, TAG_A);
    }

    // ---------------------------------------------------------------- caps
    function test_perTagCapThenAnotherTagStillWorks() public {
        for (uint256 i = 0; i < 2; i++) {
            (address w, uint256 wk) = _wallet();
            _drip(w, wk, TAG_A);
        }
        (address a, uint256 k) = _wallet();
        (uint256 dl, bytes memory sig) = _req(k, a);
        vm.prank(relayer);
        vm.expectRevert(NorenGasStation.TagCapReached.selector);
        station.drip(payable(a), dl, sig, TAG_A);
        vm.prank(relayer);
        station.drip(payable(a), dl, sig, TAG_B);
        assertEq(a.balance, DRIP);
    }

    function test_dailyCapThenResetsNextDay() public {
        for (uint256 i = 0; i < 5; i++) {
            (address w, uint256 wk) = _wallet();
            _drip(w, wk, keccak256(abi.encode(i)));
        }
        (address a, uint256 k) = _wallet();
        (uint256 dl, bytes memory sig) = _req(k, a);
        vm.prank(relayer);
        vm.expectRevert(NorenGasStation.DailyCapReached.selector);
        station.drip(payable(a), dl, sig, TAG_B);

        vm.warp((block.timestamp / 1 days + 1) * 1 days + 60);
        _drip(a, k, TAG_B);
        assertEq(a.balance, DRIP);
        assertEq(station.totalDrips(), 6);
    }

    function test_emptyStationFailsLoudly() public {
        vm.prank(address(this));
        station.withdraw(payable(address(0xbeef)), address(station).balance - DRIP + 1);
        (address a, uint256 k) = _wallet();
        (uint256 dl, bytes memory sig) = _req(k, a);
        vm.prank(relayer);
        vm.expectRevert(NorenGasStation.Empty.selector);
        station.drip(payable(a), dl, sig, TAG_A);
        assertFalse(station.dripped(a));
    }

    // ---------------------------------------------------------------- owner
    function test_onlyOwnerConfiguresAndWithdraws() public {
        vm.startPrank(relayer);
        vm.expectRevert(NorenGasStation.NotOwner.selector);
        station.configure(1, 1, 1, 0, 0);
        vm.expectRevert(NorenGasStation.NotOwner.selector);
        station.withdraw(payable(relayer), 1);
        vm.expectRevert(NorenGasStation.NotOwner.selector);
        station.setRelayer(relayer);
        vm.expectRevert(NorenGasStation.NotOwner.selector);
        station.withdrawToken(IERC20(address(usdc)), relayer, 1);
        vm.stopPrank();
    }

    function test_badConfigRefused() public {
        vm.expectRevert(NorenGasStation.BadConfig.selector);
        station.configure(0, 5, 2, USDC_PACK, WBTC_PACK);
        vm.expectRevert(NorenGasStation.BadConfig.selector);
        station.configure(0.02 ether, 5, 2, USDC_PACK, WBTC_PACK);
        vm.expectRevert(NorenGasStation.BadConfig.selector);
        station.configure(DRIP, 0, 2, USDC_PACK, WBTC_PACK);
    }

    function test_rotatedRelayerLosesAccess() public {
        address next = makeAddr("next");
        station.setRelayer(next);
        (address a, uint256 k) = _wallet();
        (uint256 dl, bytes memory sig) = _req(k, a);
        vm.prank(relayer);
        vm.expectRevert(NorenGasStation.NotRelayer.selector);
        station.drip(payable(a), dl, sig, TAG_A);
        vm.prank(next);
        station.drip(payable(a), dl, sig, TAG_A);
        assertEq(a.balance, DRIP);
    }

    // ---------------------------------------------------------------- token pack
    function test_noTokensLeftFailsLoudlyAndPaysNothing() public {
        station.withdrawToken(IERC20(address(usdc)), address(0xbeef), usdc.balanceOf(address(station)) - USDC_PACK + 1);
        (address a, uint256 k) = _wallet();
        (uint256 dl, bytes memory sig) = _req(k, a);
        vm.prank(relayer);
        vm.expectRevert(NorenGasStation.TokensEmpty.selector);
        station.drip(payable(a), dl, sig, TAG_A);
        assertEq(a.balance, 0);
        assertFalse(station.dripped(a));
    }

    function test_packCanBeGasOnly() public {
        station.configure(DRIP, 5, 2, 0, 0);
        (address a, uint256 k) = _wallet();
        _drip(a, k, TAG_A);
        assertEq(a.balance, DRIP);
        assertEq(usdc.balanceOf(a), 0);
        (,, uint256 funded) = station.room(TAG_A);
        assertEq(funded, (1 ether - DRIP) / DRIP);
    }

    function test_tokenPackIsSpendableRightAway() public {
        (address a, uint256 k) = _wallet();
        _drip(a, k, TAG_A);
        vm.prank(a);
        usdc.transfer(address(0xcafe), USDC_PACK);
        assertEq(usdc.balanceOf(address(0xcafe)), USDC_PACK);
    }

    // ---------------------------------------------------------------- fuzz
    function testFuzz_onlyTheWalletsOwnKeyWorks(uint256 signer, uint256 owner_) public {
        signer = bound(signer, 1, 2 ** 128);
        owner_ = bound(owner_, 1, 2 ** 128);
        vm.assume(signer != owner_);
        address a = vm.addr(owner_);
        vm.assume(a.code.length == 0 && a.balance == 0);
        uint256 dl = block.timestamp + 10 minutes;
        bytes memory sig = _sign(signer, station.digest(a, dl));
        vm.prank(relayer);
        vm.expectRevert(NorenGasStation.BadSignature.selector);
        station.drip(payable(a), dl, sig, TAG_A);
    }
}
