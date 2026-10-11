// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployTestnet} from "../script/DeployTestnet.s.sol";
import {MockERC20} from "./utils/Mocks.sol";

/// A settlement asset that also exposes the EIP-3009 type hash, as USDC does.
contract MockEip3009Token is MockERC20 {
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
}

/// The two getters the script reads from a Safe.
contract MockSafe {
    uint256 public threshold;
    address[] internal owners;

    constructor(uint256 threshold_, uint256 ownerCount) {
        threshold = threshold_;
        for (uint256 i = 0; i < ownerCount; i++) {
            owners.push(address(uint160(0x1000 + i)));
        }
    }

    function getThreshold() external view returns (uint256) {
        return threshold;
    }

    function getOwners() external view returns (address[] memory) {
        return owners;
    }
}

/// Exposes the script's deployment step without broadcasting or writing files.
contract DeployTestnetHarness is DeployTestnet {
    function deployForTest(Inputs memory inputs) external returns (Deployed memory) {
        check(inputs);
        Deployed memory d = deploy(inputs);
        verify(inputs, d);
        return d;
    }
}

contract DeployTestnetTest is Test {
    DeployTestnetHarness internal script;
    MockEip3009Token internal usdc;
    MockSafe internal safe;

    function setUp() public {
        vm.chainId(10143);
        script = new DeployTestnetHarness();
        usdc = new MockEip3009Token();
        safe = new MockSafe(2, 3);
    }

    function inputs() internal view returns (DeployTestnet.Inputs memory) {
        return DeployTestnet.Inputs({
            settlementAsset: address(usdc),
            settlementDecimals: 6,
            operator: address(safe),
            admin: address(safe),
            minEvaluationInterval: 36000
        });
    }

    function test_deploysAllThreeWithTheDecidedValues() public {
        DeployTestnet.Deployed memory d = script.deployForTest(inputs());
        assertEq(d.spendPolicy.settlementAsset(), address(usdc));
        assertEq(d.x402Validator.settlementAsset(), address(usdc));
        assertEq(d.reallocation.operator(), address(safe));
        assertEq(d.reallocation.admin(), address(safe));
        assertEq(d.reallocation.minEvaluationInterval(), 36000);
        assertEq(d.reallocation.capitalFloor(), 60_000, "0.06 USDC at 6 decimals");
    }

    function test_refusesAnyChainButMonadTestnet() public {
        vm.chainId(143);
        vm.expectRevert(abi.encodeWithSelector(DeployTestnet.WrongChain.selector, 143));
        script.deployForTest(inputs());
    }

    function test_refusesWrongDecimalsAndAnAssetWithoutEip3009() public {
        DeployTestnet.Inputs memory i = inputs();
        i.settlementDecimals = 18;
        vm.expectRevert(abi.encodeWithSelector(DeployTestnet.WrongDecimals.selector, 18, 6));
        script.deployForTest(i);

        MockERC20 plain = new MockERC20();
        i = inputs();
        i.settlementAsset = address(plain);
        vm.expectRevert(abi.encodeWithSelector(DeployTestnet.NoEip3009.selector, address(plain)));
        script.deployForTest(i);
    }

    function test_refusesAnEoaOrAWeakSafeForEitherRole() public {
        DeployTestnet.Inputs memory i = inputs();
        i.operator = makeAddr("eoa");
        vm.expectRevert(abi.encodeWithSelector(DeployTestnet.NoCode.selector, "operator", i.operator));
        script.deployForTest(i);

        MockSafe single = new MockSafe(1, 3);
        i = inputs();
        i.admin = address(single);
        vm.expectRevert(abi.encodeWithSelector(DeployTestnet.WeakSafe.selector, "admin", address(single), 1, 3));
        script.deployForTest(i);

        MockSafe twoOwners = new MockSafe(2, 2);
        i = inputs();
        i.operator = address(twoOwners);
        vm.expectRevert(abi.encodeWithSelector(DeployTestnet.WeakSafe.selector, "operator", address(twoOwners), 2, 2));
        script.deployForTest(i);
    }

    function test_refusesAZeroInterval() public {
        DeployTestnet.Inputs memory i = inputs();
        i.minEvaluationInterval = 0;
        vm.expectRevert(bytes("MONADEUM_MIN_EVALUATION_INTERVAL must be positive"));
        script.deployForTest(i);
    }
}
