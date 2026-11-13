// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NorenTestToken} from "../src/NorenTestToken.sol";
import {NorenStockOracle} from "../src/NorenStockOracle.sol";
import {NorenStockDesk} from "../src/NorenStockDesk.sol";
import {NorenStockCredit} from "../src/NorenStockCredit.sol";
import {NorenStockStarter} from "../src/NorenStockStarter.sol";

/// Adds stocks to an existing Noren deployment: five test stock tokens, the signed stock price oracle, the stock desk
/// (pay with stocks, swap), credit against stocks with its Earn pool, and the one-per-address stock starter pack.
/// Env: NOREN_DEPLOYER_KEY (owner of tUSDC), NOREN_IN (deployment json), NOREN_PRICER (the price relayer's signing
/// address), NOREN_OUT.
contract DeployStocks is Script {
    string constant SOURCE =
        "Yahoo Finance chart API (regularMarketPrice, delayed quotes), signed by the Noren price relayer";

    function run() external {
        uint256 pk = vm.envUint("NOREN_DEPLOYER_KEY");
        address me = vm.addr(pk);
        string memory d = vm.readFile(vm.envString("NOREN_IN"));
        address usdc = vm.parseJsonAddress(d, ".tUSDC");
        address pricer = vm.envAddress("NOREN_PRICER");
        uint256 packs = vm.envOr("NOREN_STOCK_PACKS", uint256(300));

        string[5] memory syms = ["NVDA", "TSLA", "AAPL", "MSFT", "SPY"];
        string[5] memory names = ["NVIDIA", "Tesla", "Apple", "Microsoft", "SPDR S&P 500 ETF"];
        uint256[5] memory pack = [uint256(2e18), 1e18, 2e18, 1e18, 1e18];

        vm.startBroadcast(pk);
        NorenStockOracle oracle = new NorenStockOracle(me, pricer, 3600, SOURCE);
        NorenStockDesk desk = new NorenStockDesk(me, IERC20(usdc), oracle, 50);
        NorenStockCredit credit = new NorenStockCredit(me, IERC20(usdc), oracle);
        address[] memory toks = new address[](5);
        uint256[] memory amts = new uint256[](5);
        for (uint256 i; i < 5; i++) {
            NorenTestToken t = new NorenTestToken(
                string.concat("Noren test ", names[i], " stock"), string.concat("t", syms[i]), 18, 1e18, me
            );
            toks[i] = address(t);
            amts[i] = pack[i];
            oracle.list(address(t), syms[i]);
            credit.listAsset(address(t));
            t.mint(address(desk), 100e18);
        }
        NorenStockStarter starter = new NorenStockStarter(me, toks, amts);
        for (uint256 i; i < 5; i++) {
            NorenTestToken(toks[i]).mint(address(starter), packs * amts[i]);
        }
        NorenTestToken(usdc).mint(address(desk), 50_000e6);
        NorenTestToken(usdc).mint(me, 25_000e6);
        IERC20(usdc).approve(address(credit), 25_000e6);
        credit.supply(25_000e6);
        vm.stopBroadcast();

        string memory o = "stocks";
        vm.serializeAddress(o, "stockOracle", address(oracle));
        vm.serializeAddress(o, "stockDesk", address(desk));
        vm.serializeAddress(o, "stockCredit", address(credit));
        vm.serializeAddress(o, "stockStarter", address(starter));
        vm.serializeAddress(o, "pricer", pricer);
        vm.serializeUint(o, "stocksDeployBlock", block.number);
        vm.serializeAddress(o, "tNVDA", toks[0]);
        vm.serializeAddress(o, "tTSLA", toks[1]);
        vm.serializeAddress(o, "tAAPL", toks[2]);
        vm.serializeAddress(o, "tMSFT", toks[3]);
        string memory json = vm.serializeAddress(o, "tSPY", toks[4]);
        vm.writeJson(json, vm.envString("NOREN_OUT"));
        console2.log("NorenStockOracle", address(oracle));
        console2.log("NorenStockDesk", address(desk));
        console2.log("NorenStockCredit", address(credit));
        console2.log("NorenStockStarter", address(starter));
    }
}
