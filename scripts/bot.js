// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// You can also run a script with `npx hardhat run <script>`. If you do that, Hardhat
// will compile your contracts, add the Hardhat Runtime Environment's members to the
// global scope, and execute the script.
const hre = require("hardhat");
const { ethers } = require("ethers");
require("dotenv").config();
var colors = require("colors");

colors.setTheme({
  custom: ["rainbow", "bold", "underline", "dim"],
});

const mainnetData = require("../addresses/mainnet.json");
const priceFeedAbi = require("../abi/PriceFeed.json");
const multiTroveGetterAbi = require("../abi/MultiTroveGetter.json");
const troveManagerAbi = require("../abi/TroveManager.json");

const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL;

async function main() {
  const provider = new ethers.providers.WebSocketProvider(
    MAINNET_RPC_URL,
    "mainnet"
  );

  // get all needed contracts for the bot

  //priceFeed for listening to new ETH price
  // const priceFeedAddress = mainnetData.addresses["priceFeed"];
  // const priceFeed = new ethers.Contract(
  //   priceFeedAddress,
  //   priceFeedAbi,
  //   provider
  // );

  // possible to fetch all troves in a sorted list
  const multiTroveGetterAddress = mainnetData.addresses["multiTroveGetter"];
  const multiTroveGetter = await hre.ethers.getContractAt(
    multiTroveGetterAbi,
    multiTroveGetterAddress
  );

  const signer = await hre.ethers.getSigner();

  // troveManager: to get current ICR of the troves
  const troveManagerAddress = mainnetData.addresses["troveManager"];
  const troveManager = await hre.ethers.getContractAt(
    troveManagerAbi,
    troveManagerAddress,
    signer
  );

  // let lastPrice = ethers.utils.parseEther("0");

  // priceFeed.on("LastGoodPriceUpdated", async (price) => {
  //   log(`new price from pricefeed: ${price}`, "green");
  //   if (lastPrice.gt(price)) {
  //     log(
  //       `price: ${ethers.utils.formatEther(
  //         price
  //       )} is lower than ${ethers.utils.formatEther(lastPrice)}`
  //     );

  //     //If new price is lower than the last price
  //     // check all troves for the new Current ICR
  //     await checkColletaral(multiTroveGetter, troveManager, price);
  //   }

  //   lastPrice = price;
  // });

  let liquidationPrice;
  let troves = [];

  /** Event Listeners */
  troveManager.on("TroveUpdated", async (info) => {
    console.log(info);
    const clPrice = await getChainLinkPrice(signer);

    troves = await multiTroveGetter.getMultipleSortedTroves(-1, 50);

    liquidationPrice = await checkColletaral(
      troves,
      troveManager,
      ethers.utils.parseEther(clPrice)
    );
  });

  troveManager.on("TroveIndexUpdated", async (info) => {
    console.log(info);
    const clPrice = await getChainLinkPrice(signer);

    troves = await multiTroveGetter.getMultipleSortedTroves(-1, 50);

    liquidationPrice = await checkColletaral(
      troves,
      troveManager,
      ethers.utils.parseEther(clPrice)
    );
  });

  /** Bot Start */
  console.log("");
  console.log(colors.custom(`====== LIQUITY BOT ======`));
  console.log("");
  log("-----------------------------", "blue");
  // log("Starting with Chainlink price...", "blue");
  const clPrice = await getChainLinkPrice(signer);

  troves = await multiTroveGetter.getMultipleSortedTroves(-1, 50);

  liquidationPrice = await checkColletaral(
    troves,
    troveManager,
    ethers.utils.parseEther(clPrice)
  );
  // lastPrice = ethers.utils.parseEther(clPrice);
  // log(`Last Price: ${lastPrice}`, "green");
  log("-----------------------------", "blue");
  log("Starting looking for event...", "blue");

  setInterval(
    async () =>
      await checkToLiquidate(signer, liquidationPrice, troves, troveManager),
    10000
  );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function log(message, color) {
  const _color = color ? color : "blue";
  console.log(
    colors[_color](`[${new Date().toLocaleTimeString()}] ${message}`)
  );
}

const checkColletaral = async (troves, troveManager, currentPrice) => {
  try {
    let liquidationPrice;
    // const troves = await multiTroveGetter.getMultipleSortedTroves(-1, 50);
    let liquidateTroves = [];
    if (troves.length) {
      for (let index = 0; index < troves.length; index++) {
        const trove = troves[index][0];
        log(`${index + 1}. trove: ${trove}`, "red");
        const icr = await troveManager.getCurrentICR(trove, currentPrice);
        const icrNumber = parseFloat(ethers.utils.formatEther(icr));
        log(`current ICR: ${icrNumber}`, "red");
        if (icrNumber >= 1.1) {
          if (liquidateTroves.length === 0) {
            log("No Troves can be liquidate...");
          }
          liquidationPrice =
            (parseFloat(ethers.utils.formatEther(currentPrice)) * 1.1) /
            icrNumber;

          break;
        }
        liquidateTroves.push(trove);
      }
      log("trove check ends...", "blue");

      // Use batchLiquidate if some troves can liquidate
      if (liquidateTroves.length > 0) {
        log(`try to liquidate ${troves.length} trove(s)...`);

        const tx = await troveManager.batchLiquidateTroves(liquidateTroves);

        const receipt = await tx.wait(1);

        if (receipt.status == 1) {
          log("Succesfull liquidate trove(s)...", "green");
        }
      }
      log(`Actual liquidation price is ${liquidationPrice}`);
    }
    return liquidationPrice;
  } catch (e) {
    log(`error: ${e}`);
  }
};

const getChainLinkPrice = async (signer) => {
  const chainlinkPriceFeedAddress = mainnetData.addresses["chainLinkPriceFeed"];
  const _contractData = require("../artifacts/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol/AggregatorV3Interface.json");
  const chainlinkPriceFeed = await hre.ethers.getContractAt(
    _contractData["abi"],
    chainlinkPriceFeedAddress,
    signer
  );

  const _latestData = await chainlinkPriceFeed.latestRoundData();
  const _price =
    parseFloat(hre.ethers.utils.formatEther(_latestData[1])) * 10 ** 10;
  log(`chainlink price: ${_price}`, "red");

  return _price.toString();
};

async function checkToLiquidate(
  signer,
  liquidationPrice,
  troves,
  troveManager
) {
  const _price = await getChainLinkPrice(signer);

  if (parseFloat(_price) <= liquidationPrice) {
    await checkColletaral(
      troves,
      troveManager,
      ethers.utils.parseEther(_price)
    );
  }
}
