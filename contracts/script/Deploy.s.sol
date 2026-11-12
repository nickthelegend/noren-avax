// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console2} from "forge-std/Script.sol";
import {NorenCredit} from "../src/NorenCredit.sol";
import {NorenMerchants} from "../src/NorenMerchants.sol";
import {NorenTestToken} from "../src/NorenTestToken.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";
import {EncryptedERC} from "../src/vendor/eerc/EncryptedERC.sol";
import {Registrar} from "../src/vendor/eerc/Registrar.sol";
import {IRegistrar} from "../src/vendor/eerc/interfaces/IRegistrar.sol";
import {RegistrationVerifier} from "../src/vendor/eerc/prod/RegistrationVerifier.sol";
import {MintVerifier} from "../src/vendor/eerc/prod/MintVerifier.sol";
import {WithdrawVerifier} from "../src/vendor/eerc/prod/WithdrawVerifier.sol";
import {TransferVerifier} from "../src/vendor/eerc/prod/TransferVerifier.sol";
import {BurnVerifier} from "../src/vendor/eerc/prod/BurnVerifier.sol";
import {CreateEncryptedERCParams} from "../src/vendor/eerc/types/Types.sol";
import {LocalFeed} from "../test/utils/LocalFeed.sol";

/// Deploys Noren on Avalanche: test assets, Ava Labs eERC in converter mode over tUSDC (2 decimals,
/// prod verifiers) with its Registrar, the credit line priced by Chainlink, and the merchant registry.
/// Env: NOREN_DEPLOYER_KEY, NOREN_OUT, and on Fuji NOREN_BTC_FEED / NOREN_AVAX_FEED (Chainlink).
/// On a local chain (31337) without feed addresses it deploys local feeds at today's prices.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("NOREN_DEPLOYER_KEY");
        address deployer = vm.addr(pk);
        vm.startBroadcast(pk);

        NorenTestToken usdc = new NorenTestToken("Noren Test USDC", "tUSDC", 6, 250e6, deployer);
        NorenTestToken wbtc = new NorenTestToken("Noren Test WBTC", "tWBTC", 8, 0.01e8, deployer);

        address btcFeed = vm.envOr("NOREN_BTC_FEED", address(0));
        address avaxFeed = vm.envOr("NOREN_AVAX_FEED", address(0));
        if (btcFeed == address(0)) {
            require(block.chainid == 31337, "NOREN_BTC_FEED required off the local chain");
            btcFeed = address(new LocalFeed(73_000e8));
            avaxFeed = address(new LocalFeed(8.5e8));
        }

        Registrar registrar = new Registrar(address(new RegistrationVerifier()));
        EncryptedERC eerc = new EncryptedERC(
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

        NorenCredit credit = new NorenCredit(usdc, 600, deployer); // 6% APR
        credit.listAsset(address(wbtc), AggregatorV3Interface(btcFeed), 6_000, 7_500, 500, 25 hours);
        credit.listAsset(address(0), AggregatorV3Interface(avaxFeed), 5_000, 6_500, 800, 25 hours);
        usdc.mint(deployer, 25_000e6);
        usdc.approve(address(credit), 25_000e6);
        credit.fund(25_000e6);

        NorenMerchants merchants = new NorenMerchants(IRegistrar(address(registrar)));
        vm.stopBroadcast();

        string memory o = "deploy";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "deployBlock", block.number);
        vm.serializeAddress(o, "deployer", deployer);
        vm.serializeAddress(o, "tUSDC", address(usdc));
        vm.serializeAddress(o, "tWBTC", address(wbtc));
        vm.serializeAddress(o, "btcUsdFeed", btcFeed);
        vm.serializeAddress(o, "avaxUsdFeed", avaxFeed);
        vm.serializeAddress(o, "registrar", address(registrar));
        vm.serializeAddress(o, "encryptedERC", address(eerc));
        vm.serializeAddress(o, "norenCredit", address(credit));
        string memory json = vm.serializeAddress(o, "norenMerchants", address(merchants));
        vm.writeJson(json, vm.envString("NOREN_OUT"));
        console2.log("EncryptedERC", address(eerc));
        console2.log("NorenCredit", address(credit));
        console2.log("NorenMerchants", address(merchants));
    }
}
