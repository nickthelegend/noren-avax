// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IRegistrar} from "./vendor/eerc/interfaces/IRegistrar.sol";
import {NorenMerchants} from "./NorenMerchants.sol";

/// @title NorenSettlement: the public record of Noren's settlement hub.
/// @notice A direct eERC payment hides the amount but shows on Snowtrace that this customer paid that shop. With the
///         hub, customers pay the hub (an eERC account run by Noren) privately, with the shop and order in a note
///         encrypted to the hub. At intervals the hub pays every shop it owes in one batch, one private eERC transfer
///         per shop, plus cover transfers of zero to other shops, so the payout set doesn't show which shops sold.
///         Snowtrace then shows "customer paid the hub" and, later, "hub paid shops A, B, C", with every amount
///         encrypted. This contract records each batch:
///           - the customer payments it covers (eERC tx hashes, each settled at most once),
///           - one payout per shop (the hub's eERC tx hash and a salted hash of that shop's itemised statement),
///           - the statement for the shop's own accountant, encrypted to the accountant's eERC key,
///           - the whole batch statement encrypted to the eERC auditor, who can check every payment against its
///             auditor ciphertext and that payouts add up to the payments.
/// @dev The record is a commitment by the hub; it cannot read eERC amounts. Checks that need amounts are done by the
///      shop (its key), the accountant (its statement) and the auditor (every ciphertext), off chain.
contract NorenSettlement {
    struct Payout {
        uint256 shopId;
        bytes32 payoutTx; // the hub's eERC transfer to the shop owner
        bytes32 digest; // keccak256 of the shop's statement (JSON with a random salt)
        bytes forAccountant; // the statement, Poseidon-encrypted to the shop accountant's eERC key; empty if none
    }

    NorenMerchants public immutable merchants;
    IRegistrar public immutable registrar;
    address public immutable encryptedERC;
    address public owner;
    address public hub;
    uint256 public batchCount;

    uint256 public constant MAX_PAYOUTS = 32;

    /// payment tx hash => batch id + 1 (0 = not settled)
    mapping(bytes32 => uint256) public settledIn;
    mapping(bytes32 => bool) public payoutRecorded;
    mapping(uint256 => address) public accountantOf;

    event BatchSettled(
        uint256 indexed batchId, uint64 at, bytes32[] payments, bytes32[] payoutTxs, bytes32[] refunds, bytes forAuditor
    );
    event ShopPayout(
        uint256 indexed batchId,
        uint256 indexed shopId,
        bytes32 payoutTx,
        bytes32 digest,
        address accountant,
        bytes forAccountant
    );
    event AccountantSet(uint256 indexed shopId, address indexed accountant);
    event HubSet(address hub);

    error NotOwner();
    error NotHub();
    error NotShopOwner();
    error NotRegistered(address who);
    error EmptyBatch();
    error TooManyPayouts();
    error AlreadySettled(bytes32 payment);
    error PayoutReused(bytes32 payoutTx);
    error DuplicateShop(uint256 shopId);
    error MissingStatement(uint256 shopId);
    error BadHash();

    constructor(NorenMerchants merchants_, IRegistrar registrar_, address encryptedERC_, address hub_) {
        merchants = merchants_;
        registrar = registrar_;
        encryptedERC = encryptedERC_;
        owner = msg.sender;
        _setHub(hub_);
    }

    /// @notice A shop owner names the accountant who gets that shop's statements. The accountant must have an eERC
    ///         key (registered with the Registrar), because statements are encrypted to it. address(0) removes it.
    function setAccountant(uint256 shopId, address accountant) external {
        if (merchants.shop(shopId).owner != msg.sender) revert NotShopOwner();
        if (accountant != address(0) && !registrar.isUserRegistered(accountant)) revert NotRegistered(accountant);
        accountantOf[shopId] = accountant;
        emit AccountantSet(shopId, accountant);
    }

    /// @notice Records one settlement batch. Only the hub.
    /// @param payments the customer-to-hub eERC transfers this batch settles
    /// @param payouts one entry per shop paid in this batch (real or cover)
    /// @param refunds the hub's eERC transfers that returned unroutable payments to their senders
    /// @param forAuditor the full batch statement, Poseidon-encrypted to the eERC auditor key
    function settle(bytes32[] calldata payments, Payout[] calldata payouts, bytes32[] calldata refunds, bytes calldata forAuditor)
        external
        returns (uint256 batchId)
    {
        if (msg.sender != hub) revert NotHub();
        if (payouts.length == 0 && refunds.length == 0) revert EmptyBatch();
        if (payouts.length > MAX_PAYOUTS) revert TooManyPayouts();
        batchId = batchCount++;

        for (uint256 i; i < payments.length; ++i) {
            bytes32 p = payments[i];
            if (p == bytes32(0)) revert BadHash();
            if (settledIn[p] != 0) revert AlreadySettled(p);
            settledIn[p] = batchId + 1;
        }
        for (uint256 i; i < refunds.length; ++i) _usePayoutTx(refunds[i]);

        bytes32[] memory txs = new bytes32[](payouts.length);
        for (uint256 i; i < payouts.length; ++i) {
            Payout calldata o = payouts[i];
            merchants.shop(o.shopId); // reverts for an unknown shop
            for (uint256 j; j < i; ++j) if (payouts[j].shopId == o.shopId) revert DuplicateShop(o.shopId);
            if (o.digest == bytes32(0)) revert BadHash();
            _usePayoutTx(o.payoutTx);
            address acct = accountantOf[o.shopId];
            if (acct != address(0) && o.forAccountant.length == 0) revert MissingStatement(o.shopId);
            txs[i] = o.payoutTx;
            emit ShopPayout(batchId, o.shopId, o.payoutTx, o.digest, acct, o.forAccountant);
        }
        emit BatchSettled(batchId, uint64(block.timestamp), payments, txs, refunds, forAuditor);
    }

    function setHub(address hub_) external {
        if (msg.sender != owner) revert NotOwner();
        _setHub(hub_);
    }

    function transferOwnership(address o) external {
        if (msg.sender != owner) revert NotOwner();
        owner = o;
    }

    function _usePayoutTx(bytes32 t) private {
        if (t == bytes32(0)) revert BadHash();
        if (payoutRecorded[t]) revert PayoutReused(t);
        payoutRecorded[t] = true;
    }

    function _setHub(address hub_) private {
        if (!registrar.isUserRegistered(hub_)) revert NotRegistered(hub_);
        hub = hub_;
        emit HubSet(hub_);
    }
}
