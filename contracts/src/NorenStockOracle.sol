// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// Stock prices for Noren's test stock tokens on Fuji. Chainlink has no equity feeds on Fuji, so Noren's price relayer
/// reads a public quote API (`source`), signs a report and anyone may submit it here. A report is accepted only with the
/// relayer's signature, for this chain and this contract, newer than the last one and not from the future. Reads
/// refuse a price whose report is older than `maxAge`. `marketTime` is when the quote itself was made (the last trade
/// or close); it is reported, not enforced, because markets close at night and at weekends.
contract NorenStockOracle is Ownable {
    struct Price {
        uint128 price8; // USD with 8 decimals, like a Chainlink answer
        uint64 marketTime; // the quote's own time
        uint64 signedAt; // when the relayer signed the report
    }

    string public source;
    address public signer;
    uint32 public maxAge;
    uint64 public lastSignedAt;
    mapping(address => Price) internal prices;
    mapping(address => string) public symbolOf;
    address[] public tokens;

    event Listed(address indexed token, string symbol);
    event SignerSet(address signer);
    event MaxAgeSet(uint32 maxAge);
    event PriceUpdated(address indexed token, uint256 price8, uint64 marketTime, uint64 signedAt);

    error BadSignature();
    error OldReport(uint64 signedAt, uint64 last);
    error FutureReport(uint64 signedAt);
    error LengthMismatch();
    error UnknownToken(address token);
    error BadPrice(address token);
    error StalePrice(address token, uint256 signedAt, uint256 maxAge);

    constructor(address owner_, address signer_, uint32 maxAge_, string memory source_) Ownable(owner_) {
        signer = signer_;
        maxAge = maxAge_;
        source = source_;
        emit SignerSet(signer_);
        emit MaxAgeSet(maxAge_);
    }

    function list(address token, string calldata symbol) external onlyOwner {
        if (bytes(symbolOf[token]).length == 0) tokens.push(token);
        symbolOf[token] = symbol;
        emit Listed(token, symbol);
    }

    function setSigner(address s) external onlyOwner {
        signer = s;
        emit SignerSet(s);
    }

    function setMaxAge(uint32 a) external onlyOwner {
        maxAge = a;
        emit MaxAgeSet(a);
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    /// The digest the relayer signs (EIP-191 personal_sign over these 32 bytes).
    function digest(address[] calldata tokens_, uint256[] calldata prices8, uint64[] calldata marketTimes, uint64 signedAt)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode("Noren stock price v1", block.chainid, address(this), tokens_, prices8, marketTimes, signedAt));
    }

    function submit(
        address[] calldata tokens_,
        uint256[] calldata prices8,
        uint64[] calldata marketTimes,
        uint64 signedAt,
        bytes calldata sig
    ) external {
        if (tokens_.length != prices8.length || tokens_.length != marketTimes.length) revert LengthMismatch();
        if (signedAt <= lastSignedAt) revert OldReport(signedAt, lastSignedAt);
        if (signedAt > block.timestamp + 120) revert FutureReport(signedAt);
        bytes32 h = MessageHashUtils.toEthSignedMessageHash(digest(tokens_, prices8, marketTimes, signedAt));
        (address got, ECDSA.RecoverError err,) = ECDSA.tryRecover(h, sig);
        if (err != ECDSA.RecoverError.NoError || got != signer || got == address(0)) revert BadSignature();
        lastSignedAt = signedAt;
        for (uint256 i; i < tokens_.length; i++) {
            address t = tokens_[i];
            if (bytes(symbolOf[t]).length == 0) revert UnknownToken(t);
            if (prices8[i] == 0 || prices8[i] > type(uint128).max) revert BadPrice(t);
            prices[t] = Price(uint128(prices8[i]), marketTimes[i], signedAt);
            emit PriceUpdated(t, prices8[i], marketTimes[i], signedAt);
        }
    }

    /// Fresh price or revert. USD with 8 decimals.
    function price(address token) public view returns (uint256 price8, uint256 marketTime, uint256 signedAt) {
        Price memory p = prices[token];
        if (bytes(symbolOf[token]).length == 0) revert UnknownToken(token);
        if (p.price8 == 0) revert StalePrice(token, 0, maxAge);
        if (block.timestamp > uint256(p.signedAt) + maxAge) revert StalePrice(token, p.signedAt, maxAge);
        return (p.price8, p.marketTime, p.signedAt);
    }

    /// The last stored report for a token, fresh or not (for display).
    function last(address token) external view returns (uint256 price8, uint256 marketTime, uint256 signedAt, bool fresh) {
        Price memory p = prices[token];
        return (p.price8, p.marketTime, p.signedAt, p.price8 != 0 && block.timestamp <= uint256(p.signedAt) + maxAge);
    }
}
