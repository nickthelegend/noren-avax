// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IRegistrar} from "./vendor/eerc/interfaces/IRegistrar.sol";

/// Noren Merchant registry: a shop, its catalogue and the address its private revenue lands on.
/// A shop can only open once its owner is registered with the eERC Registrar, so every checkout
/// can pay it privately.
contract NorenMerchants {
    struct Item {
        string name;
        uint64 priceCents; // eERC units: tUSDC with 2 decimals
        bool active;
    }

    struct Shop {
        address owner;
        string name;
        string slug;
        uint64 openedAt;
    }

    IRegistrar public immutable registrar;
    Shop[] private _shops;
    mapping(uint256 => Item[]) private _items;
    mapping(bytes32 => uint256) private _bySlug; // slug hash => shop id + 1
    mapping(address => uint256[]) private _byOwner;

    event ShopOpened(uint256 indexed shopId, address indexed owner, string name, string slug);
    event ItemListed(uint256 indexed shopId, uint256 indexed itemId, string name, uint64 priceCents);
    event ItemUpdated(uint256 indexed shopId, uint256 indexed itemId, uint64 priceCents, bool active);

    error NotRegistered(address owner);
    error SlugTaken(string slug);
    error BadSlug();
    error BadName();
    error BadPrice();
    error NotShopOwner();
    error UnknownShop(uint256 shopId);
    error UnknownItem(uint256 itemId);

    constructor(IRegistrar registrar_) {
        registrar = registrar_;
    }

    function openShop(string calldata name, string calldata slug) external returns (uint256 shopId) {
        if (!registrar.isUserRegistered(msg.sender)) revert NotRegistered(msg.sender);
        uint256 n = bytes(name).length;
        if (n == 0 || n > 48) revert BadName();
        _checkSlug(slug);
        bytes32 h = keccak256(bytes(slug));
        if (_bySlug[h] != 0) revert SlugTaken(slug);
        shopId = _shops.length;
        _shops.push(Shop({owner: msg.sender, name: name, slug: slug, openedAt: uint64(block.timestamp)}));
        _bySlug[h] = shopId + 1;
        _byOwner[msg.sender].push(shopId);
        emit ShopOpened(shopId, msg.sender, name, slug);
    }

    function listItem(uint256 shopId, string calldata name, uint64 priceCents) external returns (uint256 itemId) {
        _onlyOwner(shopId);
        uint256 n = bytes(name).length;
        if (n == 0 || n > 64) revert BadName();
        if (priceCents == 0) revert BadPrice();
        itemId = _items[shopId].length;
        _items[shopId].push(Item({name: name, priceCents: priceCents, active: true}));
        emit ItemListed(shopId, itemId, name, priceCents);
    }

    function updateItem(uint256 shopId, uint256 itemId, uint64 priceCents, bool active) external {
        _onlyOwner(shopId);
        if (itemId >= _items[shopId].length) revert UnknownItem(itemId);
        if (priceCents == 0) revert BadPrice();
        Item storage it = _items[shopId][itemId];
        it.priceCents = priceCents;
        it.active = active;
        emit ItemUpdated(shopId, itemId, priceCents, active);
    }

    function shopCount() external view returns (uint256) {
        return _shops.length;
    }

    function shop(uint256 shopId) public view returns (Shop memory) {
        if (shopId >= _shops.length) revert UnknownShop(shopId);
        return _shops[shopId];
    }

    function shopBySlug(string calldata slug) external view returns (uint256 shopId, Shop memory s) {
        uint256 v = _bySlug[keccak256(bytes(slug))];
        if (v == 0) revert UnknownShop(type(uint256).max);
        shopId = v - 1;
        s = _shops[shopId];
    }

    function shopsOf(address owner) external view returns (uint256[] memory) {
        return _byOwner[owner];
    }

    function items(uint256 shopId) external view returns (Item[] memory) {
        if (shopId >= _shops.length) revert UnknownShop(shopId);
        return _items[shopId];
    }

    function _onlyOwner(uint256 shopId) private view {
        if (shop(shopId).owner != msg.sender) revert NotShopOwner();
    }

    /// Lowercase a-z, 0-9 and '-', 3 to 32 characters.
    function _checkSlug(string calldata slug) private pure {
        bytes calldata b = bytes(slug);
        if (b.length < 3 || b.length > 32) revert BadSlug();
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            bool ok = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x2d;
            if (!ok) revert BadSlug();
        }
    }
}
