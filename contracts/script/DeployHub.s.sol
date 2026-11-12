// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NorenGasStation} from "../src/NorenGasStation.sol";
import {NorenMerchants} from "../src/NorenMerchants.sol";
import {NorenSettlement} from "../src/NorenSettlement.sol";
import {NorenTestToken} from "../src/NorenTestToken.sol";
import {IRegistrar} from "../src/vendor/eerc/interfaces/IRegistrar.sol";

/// Adds Noren's settlement hub record and the judge gas station to an existing Noren deployment.
/// Env: NOREN_DEPLOYER_KEY (owner of the test tokens), NOREN_IN (deployment json), NOREN_HUB (an eERC-registered
/// address), NOREN_RELAYER, NOREN_OUT, and optionally NOREN_STATION_AVAX / NOREN_STATION_PACKS.
contract DeployHub is Script {
    function run() external {
        uint256 pk = vm.envUint("NOREN_DEPLOYER_KEY");
        string memory d = vm.readFile(vm.envString("NOREN_IN"));
        address usdc = vm.parseJsonAddress(d, ".tUSDC");
        address wbtc = vm.parseJsonAddress(d, ".tWBTC");
        address merchants = vm.parseJsonAddress(d, ".norenMerchants");
        address registrar = vm.parseJsonAddress(d, ".registrar");
        address eerc = vm.parseJsonAddress(d, ".encryptedERC");
        address hub = vm.envAddress("NOREN_HUB");
        address relayer = vm.envAddress("NOREN_RELAYER");
        uint256 stationAvax = vm.envOr("NOREN_STATION_AVAX", uint256(0.02 ether));
        uint256 packs = vm.envOr("NOREN_STATION_PACKS", uint256(100));

        vm.startBroadcast(pk);
        NorenSettlement settlement = new NorenSettlement(NorenMerchants(merchants), IRegistrar(registrar), eerc, hub);
        // 0.0002 AVAX is about a billion gas at Fuji's ~160 wei; 100 tUSDC to pay with, 0.01 tWBTC to borrow against.
        NorenGasStation station =
            new NorenGasStation(relayer, 0.0002 ether, 40, 3, IERC20(usdc), 100e6, IERC20(wbtc), 0.01e8);
        NorenTestToken(usdc).mint(address(station), packs * 100e6);
        NorenTestToken(wbtc).mint(address(station), packs * 0.01e8);
        (bool ok,) = address(station).call{value: stationAvax}("");
        require(ok, "fund station");
        vm.stopBroadcast();

        string memory o = "hub";
        vm.serializeAddress(o, "norenSettlement", address(settlement));
        vm.serializeAddress(o, "norenGasStation", address(station));
        vm.serializeAddress(o, "hub", hub);
        vm.serializeUint(o, "hubDeployBlock", block.number);
        string memory json = vm.serializeAddress(o, "relayer", relayer);
        vm.writeJson(json, vm.envString("NOREN_OUT"));
        console2.log("NorenSettlement", address(settlement));
        console2.log("NorenGasStation", address(station));
    }
}
