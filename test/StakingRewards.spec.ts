import chai, { expect } from 'chai'
import { Contract, BigNumber, constants } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'
import { ecsign } from 'ethereumjs-util'

import { stakingRewardsFixture } from './fixtures'
import { REWARDS_DURATION, expandTo18Decimals, mineBlock, getApprovalDigest } from './utils'

import StakingRewards from '../build/StakingRewards.json'

chai.use(solidity)

describe('StakingRewards', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })
  const [wallet, staker, secondStaker, thirdStaker] = provider.getWallets()
  const loadFixture = createFixtureLoader([wallet], provider)

  let stakingRewards: Contract
  let rewardsToken: Contract
  let stakingToken: Contract
  beforeEach(async () => {
    const fixture = await loadFixture(stakingRewardsFixture)
    stakingRewards = fixture.stakingRewards
    rewardsToken = fixture.rewardsToken
    stakingToken = fixture.stakingToken
  })

  it('deploy cost', async () => {
    const stakingRewards = await deployContract(wallet, StakingRewards, [
      wallet.address,
      rewardsToken.address,
      stakingToken.address,
    ])
    const receipt = await provider.getTransactionReceipt(stakingRewards.deployTransaction.hash)
    // expect(receipt.gasUsed).to.eq('1381444')
  })

  const reward = expandTo18Decimals(100)
  async function start(reward: BigNumber): Promise<{ startTime: BigNumber; endTime: BigNumber }> {
    // send reward to the contract
    await rewardsToken.transfer(stakingRewards.address, reward)
    // must be called by rewardsDistribution
    await stakingRewards.notifyRewardAmount(reward, REWARDS_DURATION)

    const startTime: BigNumber = await stakingRewards.lastUpdateTime()
    const endTime: BigNumber = await stakingRewards.periodFinish()
    expect(endTime).to.be.eq(startTime.add(REWARDS_DURATION))
    return { startTime, endTime }
  }

  async function start1(reward: BigNumber, duration: number): Promise<{ startTime: BigNumber; endTime: BigNumber }> {
    // send reward to the contract
    await rewardsToken.transfer(stakingRewards.address, reward)
    // must be called by rewardsDistribution
    await stakingRewards.notifyRewardAmount(reward, duration)

    const startTime: BigNumber = await stakingRewards.lastUpdateTime()
    const endTime: BigNumber = await stakingRewards.periodFinish()
    expect(endTime).to.be.eq(startTime.add(duration))
    return { startTime, endTime }
  }

  it('notifyRewardAmount: full', async () => {
    // stake with staker
    const stake = expandTo18Decimals(2)
    await stakingToken.transfer(staker.address, stake)
    await stakingToken.connect(staker).approve(stakingRewards.address, stake)
    await stakingRewards.connect(staker).stake(stake)

    const { endTime } = await start(reward)

    // fast-forward past the reward window
    await mineBlock(provider, endTime.add(1).toNumber())

    // unstake
    await stakingRewards.connect(staker).exit()
    const stakeEndTime: BigNumber = await stakingRewards.lastUpdateTime()
    expect(stakeEndTime).to.be.eq(endTime)

    const rewardAmount = await rewardsToken.balanceOf(staker.address)
    expect(reward.sub(rewardAmount).lte(reward.div(10000))).to.be.true // ensure result is within .01%
    expect(rewardAmount).to.be.eq(reward.div(REWARDS_DURATION).mul(REWARDS_DURATION))
  })

  it('stakeWithPermit', async () => {
    // stake with staker
    const stake = expandTo18Decimals(2)
    await stakingToken.transfer(staker.address, stake)

    // get permit
    const nonce = await stakingToken.nonces(staker.address)
    const deadline = constants.MaxUint256
    const digest = await getApprovalDigest(
      stakingToken,
      { owner: staker.address, spender: stakingRewards.address, value: stake },
      nonce,
      deadline
    )
    const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(staker.privateKey.slice(2), 'hex'))

    await stakingRewards.connect(staker).stakeWithPermit(stake, deadline, v, r, s)

    const { endTime } = await start(reward)

    // fast-forward past the reward window
    await mineBlock(provider, endTime.add(1).toNumber())

    // unstake
    await stakingRewards.connect(staker).exit()
    const stakeEndTime: BigNumber = await stakingRewards.lastUpdateTime()
    expect(stakeEndTime).to.be.eq(endTime)

    const rewardAmount = await rewardsToken.balanceOf(staker.address)
    expect(reward.sub(rewardAmount).lte(reward.div(10000))).to.be.true // ensure result is within .01%
    expect(rewardAmount).to.be.eq(reward.div(REWARDS_DURATION).mul(REWARDS_DURATION))
  })

  it('notifyRewardAmount: ~half', async () => {
    const { startTime, endTime } = await start(reward)

    // fast-forward ~halfway through the reward window
    await mineBlock(provider, startTime.add(endTime.sub(startTime).div(2)).toNumber())

    // stake with staker
    const stake = expandTo18Decimals(2)
    await stakingToken.transfer(staker.address, stake)
    await stakingToken.connect(staker).approve(stakingRewards.address, stake)
    await stakingRewards.connect(staker).stake(stake)
    const stakeStartTime: BigNumber = await stakingRewards.lastUpdateTime()

    // fast-forward past the reward window
    await mineBlock(provider, endTime.add(1).toNumber())

    console.log("====>",(await stakingRewards.earned(staker.address))/1e18);
    console.log("====>",(await stakingRewards.rewards(staker.address))/1e18);

    console.log("====>staked",(await stakingRewards.balanceOf(staker.address))/1e18);

    console.log("====>userrewardperToken",(await stakingRewards.userRewardPerTokenPaid(staker.address))/1e18);
    console.log("====>rewardperToken",(await stakingRewards.rewardPerToken())/1e18);
    console.log("====>rewardperTokenStored",(await stakingRewards.rewardPerTokenStored())/1e18);


    // unstake
    await stakingRewards.connect(staker).exit()
    const stakeEndTime: BigNumber = await stakingRewards.lastUpdateTime()
    expect(stakeEndTime).to.be.eq(endTime)

    const rewardAmount = await rewardsToken.balanceOf(staker.address)
    expect(reward.div(2).sub(rewardAmount).lte(reward.div(2).div(10000))).to.be.true // ensure result is within .01%
    expect(rewardAmount).to.be.eq(reward.div(REWARDS_DURATION).mul(endTime.sub(stakeStartTime)))
  }).retries(2) // TODO investigate flakiness

  it('notifyRewardAmount: two stakers', async () => {
    // stake with first staker
    const stake = expandTo18Decimals(2)
    await stakingToken.transfer(staker.address, stake)
    await stakingToken.connect(staker).approve(stakingRewards.address, stake)
    await stakingRewards.connect(staker).stake(stake)

    const { startTime, endTime } = await start(reward)

    // fast-forward ~halfway through the reward window
    await mineBlock(provider, startTime.add(endTime.sub(startTime).div(2)).toNumber())

    // stake with second staker
    await stakingToken.transfer(secondStaker.address, stake)
    await stakingToken.connect(secondStaker).approve(stakingRewards.address, stake)
    await stakingRewards.connect(secondStaker).stake(stake)

    // fast-forward past the reward window
    await mineBlock(provider, endTime.add(1).toNumber())

    // unstake
    await stakingRewards.connect(staker).exit()
    const stakeEndTime: BigNumber = await stakingRewards.lastUpdateTime()
    expect(stakeEndTime).to.be.eq(endTime)
    await stakingRewards.connect(secondStaker).exit()

    const rewardAmount = await rewardsToken.balanceOf(staker.address)
    const secondRewardAmount = await rewardsToken.balanceOf(secondStaker.address)
    const totalReward = rewardAmount.add(secondRewardAmount)

    // ensure results are within .01%
    expect(reward.sub(totalReward).lte(reward.div(10000))).to.be.true
    expect(totalReward.mul(3).div(4).sub(rewardAmount).lte(totalReward.mul(3).div(4).div(10000)))
    expect(totalReward.div(4).sub(secondRewardAmount).lte(totalReward.div(4).div(10000)))
  })



  it('extend program', async () => {
    // stake with first staker
    let stake = expandTo18Decimals(10)
    await stakingToken.transfer(staker.address, stake)
    await stakingToken.connect(staker).approve(stakingRewards.address, stake)
    await stakingRewards.connect(staker).stake(stake)

    // stake with second staker
    stake = expandTo18Decimals(40)
    await stakingToken.transfer(secondStaker.address, stake)
    await stakingToken.connect(secondStaker).approve(stakingRewards.address, stake)
    await stakingRewards.connect(secondStaker).stake(stake)


    let { startTime, endTime } = await start1(expandTo18Decimals(500),24*3600*10)

    // fast-forward ~5 days through the reward window
    await mineBlock(provider, startTime.add(24*3600*5).toNumber())

    console.log("====> ", (await stakingRewards.earned(staker.address))/1e18);
    console.log("====> ", (await stakingRewards.earned(secondStaker.address))/1e18);

    stake = expandTo18Decimals(50)
    await stakingToken.transfer(thirdStaker.address, stake)
    await stakingToken.connect(thirdStaker).approve(stakingRewards.address, stake)
    await stakingRewards.connect(thirdStaker).stake(stake)

    let vals = await start1(expandTo18Decimals(300),24*3600*20)


    // fast-forward past the reward window
    await mineBlock(provider, vals["endTime"].add(1).toNumber())

    console.log("====> ", (await stakingRewards.earned(staker.address))/1e18);
    console.log("====> ", (await stakingRewards.earned(secondStaker.address))/1e18);
    console.log("====> ", (await stakingRewards.earned(thirdStaker.address))/1e18);

    // // unstake
    // await stakingRewards.connect(staker).exit()
    // const stakeEndTime: BigNumber = await stakingRewards.lastUpdateTime()
    // expect(stakeEndTime).to.be.eq(endTime)
    // await stakingRewards.connect(secondStaker).exit()

    // const rewardAmount = await rewardsToken.balanceOf(staker.address)
    // const secondRewardAmount = await rewardsToken.balanceOf(secondStaker.address)
    // const totalReward = rewardAmount.add(secondRewardAmount)

    // // ensure results are within .01%
    // expect(reward.sub(totalReward).lte(reward.div(10000))).to.be.true
    // expect(totalReward.mul(3).div(4).sub(rewardAmount).lte(totalReward.mul(3).div(4).div(10000)))
    // expect(totalReward.div(4).sub(secondRewardAmount).lte(totalReward.div(4).div(10000)))
  })

  it('extend program', async () => {
    // stake with first staker
    let stake = expandTo18Decimals(10)
    await stakingToken.transfer(staker.address, stake)
    await stakingToken.connect(staker).approve(stakingRewards.address, stake)
    await stakingRewards.connect(staker).stake(stake)

    // stake with second staker
    stake = expandTo18Decimals(40)
    await stakingToken.transfer(secondStaker.address, stake)
    await stakingToken.connect(secondStaker).approve(stakingRewards.address, stake)
    await stakingRewards.connect(secondStaker).stake(stake)


    let { startTime, endTime } = await start1(expandTo18Decimals(500),24*3600*10)

    // fast-forward ~5 days through the reward window
    await mineBlock(provider, startTime.add(24*3600*5).toNumber())
    console.log("=================Rewards after 5th day==============");
    console.log("====> ", (await stakingRewards.earned(staker.address))/1e18);
    console.log("====> ", (await stakingRewards.earned(secondStaker.address))/1e18);



    stake = expandTo18Decimals(50)
    await stakingToken.transfer(thirdStaker.address, stake)
    await stakingToken.connect(thirdStaker).approve(stakingRewards.address, stake)
    await stakingRewards.connect(thirdStaker).stake(stake)
let vals = await start1(expandTo18Decimals(300),24*3600*20)


    await mineBlock(provider, startTime.add(24*3600*7).toNumber())
    console.log("=================Rewards after 7th day==============");
    console.log("====> ", (await stakingRewards.earned(staker.address))/1e18);
    console.log("====> ", (await stakingRewards.earned(secondStaker.address))/1e18);
    console.log("====> ", (await stakingRewards.earned(thirdStaker.address))/1e18);
await stakingRewards.connect(secondStaker).exit()


    


    // fast-forward past the reward window
    await mineBlock(provider, vals["endTime"].add(1).toNumber())
console.log("=================Rewards after 25th day==============");
    console.log("====> ", (await stakingRewards.earned(staker.address))/1e18);
    console.log("====> ", (await stakingRewards.earned(secondStaker.address))/1e18);
    console.log("====> ", (await stakingRewards.earned(thirdStaker.address))/1e18);

    // // unstake
    // await stakingRewards.connect(staker).exit()
    // const stakeEndTime: BigNumber = await stakingRewards.lastUpdateTime()
    // expect(stakeEndTime).to.be.eq(endTime)
    // await stakingRewards.connect(secondStaker).exit()

    // const rewardAmount = await rewardsToken.balanceOf(staker.address)
    // const secondRewardAmount = await rewardsToken.balanceOf(secondStaker.address)
    // const totalReward = rewardAmount.add(secondRewardAmount)

    // // ensure results are within .01%
    // expect(reward.sub(totalReward).lte(reward.div(10000))).to.be.true
    // expect(totalReward.mul(3).div(4).sub(rewardAmount).lte(totalReward.mul(3).div(4).div(10000)))
    // expect(totalReward.div(4).sub(secondRewardAmount).lte(totalReward.div(4).div(10000)))
  })

  it('extend program', async () => {
    // stake with first staker
    let stake = expandTo18Decimals(10)
    await stakingToken.transfer(staker.address, stake)
    await stakingToken.connect(staker).approve(stakingRewards.address, stake)
    await stakingRewards.connect(staker).stake(stake)

    // stake with second staker
    stake = expandTo18Decimals(40)
    await stakingToken.transfer(secondStaker.address, stake)
    await stakingToken.connect(secondStaker).approve(stakingRewards.address, stake)
    await stakingRewards.connect(secondStaker).stake(stake)


    let { startTime, endTime } = await start1(expandTo18Decimals(500),24*3600*10)

    // fast-forward ~5 days through the reward window
    await mineBlock(provider, startTime.add(24*3600*10).toNumber())
    console.log("=================Rewards after 10th day==============");

    console.log("====> ", (await stakingRewards.earned(staker.address))/1e18);
    console.log("====> ", (await stakingRewards.earned(secondStaker.address))/1e18);

    stake = expandTo18Decimals(50)
    await stakingToken.transfer(thirdStaker.address, stake)
    await stakingToken.connect(thirdStaker).approve(stakingRewards.address, stake)
    await stakingRewards.connect(thirdStaker).stake(stake)

    let vals = await start1(expandTo18Decimals(300),24*3600*20)


    // fast-forward past the reward window
    await mineBlock(provider, vals["endTime"].add(1).toNumber())
    console.log("=================Rewards after 25th day==============");

    console.log("====> ", (await stakingRewards.earned(staker.address))/1e18);
    console.log("====> ", (await stakingRewards.earned(secondStaker.address))/1e18);
    console.log("====> ", (await stakingRewards.earned(thirdStaker.address))/1e18);

    // // unstake
    // await stakingRewards.connect(staker).exit()
    // const stakeEndTime: BigNumber = await stakingRewards.lastUpdateTime()
    // expect(stakeEndTime).to.be.eq(endTime)
    // await stakingRewards.connect(secondStaker).exit()

    // const rewardAmount = await rewardsToken.balanceOf(staker.address)
    // const secondRewardAmount = await rewardsToken.balanceOf(secondStaker.address)
    // const totalReward = rewardAmount.add(secondRewardAmount)

    // // ensure results are within .01%
    // expect(reward.sub(totalReward).lte(reward.div(10000))).to.be.true
    // expect(totalReward.mul(3).div(4).sub(rewardAmount).lte(totalReward.mul(3).div(4).div(10000)))
    // expect(totalReward.div(4).sub(secondRewardAmount).lte(totalReward.div(4).div(10000)))
  })
})
