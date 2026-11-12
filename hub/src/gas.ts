// Relays a new wallet's signed request to NorenGasStation. Every limit is enforced on chain; the checks here only
// turn an obviously doomed request into a readable error before the relayer spends gas on it.
import { createHmac } from 'node:crypto';
import { formatEther, recoverMessageAddress, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { gasDigest, norenGasStationAbi, type HubDeployment } from '@noren-avax/sdk';

export class GasRelay {
  private pub: PublicClient;
  private wallet: WalletClient;
  private d: HubDeployment;
  private salt: string;

  constructor(pub: PublicClient, wallet: WalletClient, d: HubDeployment, salt: string) {
    this.pub = pub;
    this.wallet = wallet;
    this.d = d;
    this.salt = salt;
  }

  /** A keyed hash of the requester's IP: the per-requester cap counts it on chain; the IP itself never leaves here. */
  tag(ip: string): Hex {
    return `0x${createHmac('sha256', this.salt).update(ip).digest('hex')}`;
  }

  async status(ip: string) {
    const [room, drip, usdc, wbtc, relayerBal] = await Promise.all([
      this.pub.readContract({ address: this.d.norenGasStation, abi: norenGasStationAbi, functionName: 'room', args: [this.tag(ip)] }) as Promise<readonly [bigint, bigint, bigint]>,
      this.pub.readContract({ address: this.d.norenGasStation, abi: norenGasStationAbi, functionName: 'dripAmount' }) as Promise<bigint>,
      this.pub.readContract({ address: this.d.norenGasStation, abi: norenGasStationAbi, functionName: 'usdcPack' }) as Promise<bigint>,
      this.pub.readContract({ address: this.d.norenGasStation, abi: norenGasStationAbi, functionName: 'wbtcPack' }) as Promise<bigint>,
      this.pub.getBalance({ address: this.wallet.account!.address }),
    ]);
    return {
      station: this.d.norenGasStation,
      relayer: this.wallet.account!.address,
      relayerAvax: formatEther(relayerBal),
      pack: { avax: formatEther(drip), tUSDC: Number(usdc) / 1e6, tWBTC: Number(wbtc) / 1e8 },
      todayLeft: Number(room[0]),
      youLeft: Number(room[1]),
      funded: Number(room[2]),
    };
  }

  async drip(body: { to?: string; deadline?: string | number; sig?: string }, ip: string) {
    const to = body.to as Address;
    if (!/^0x[0-9a-fA-F]{40}$/.test(to ?? '')) throw new HttpError(400, 'to must be an address');
    if (!/^0x[0-9a-fA-F]{130}$/.test(body.sig ?? '')) throw new HttpError(400, 'sig must be a 65-byte signature');
    const deadline = BigInt(body.deadline ?? 0);
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (deadline < now || deadline > now + 3600n) throw new HttpError(400, 'deadline must be within the next hour');
    const digest = gasDigest(this.d.chainId, this.d.norenGasStation, to, deadline);
    const signer = await recoverMessageAddress({ message: { raw: digest }, signature: body.sig as Hex });
    if (signer.toLowerCase() !== to.toLowerCase()) throw new HttpError(400, 'the signature is not from this wallet');
    const [dripped, bal, code] = await Promise.all([
      this.pub.readContract({ address: this.d.norenGasStation, abi: norenGasStationAbi, functionName: 'dripped', args: [to] }) as Promise<boolean>,
      this.pub.getBalance({ address: to }),
      this.pub.getCode({ address: to }),
    ]);
    if (dripped) throw new HttpError(409, 'This wallet already got its starter pack.');
    if (bal > 0n) throw new HttpError(409, 'This wallet already has AVAX, so it can use the faucets itself.');
    if (code && code !== '0x') throw new HttpError(400, 'Only plain wallets can get a starter pack.');
    const tag = this.tag(ip);
    const args = [to, deadline, body.sig as Hex, tag] as const;
    try {
      const { request } = await this.pub.simulateContract({ address: this.d.norenGasStation, abi: norenGasStationAbi, functionName: 'drip', args, account: this.wallet.account! });
      const hash = await this.wallet.writeContract(request as never);
      const r = await this.pub.waitForTransactionReceipt({ hash, pollingInterval: 500, timeout: 90_000 });
      if (r.status !== 'success') throw new HttpError(502, `drip reverted: ${hash}`);
      return { hash };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      const m = (e as { shortMessage?: string; message: string }).shortMessage ?? (e as Error).message;
      const known = /DailyCapReached|TagCapReached|Empty|TokensEmpty|AlreadyDripped|NotNew/.exec(m)?.[0];
      const text: Record<string, string> = {
        DailyCapReached: 'Today’s starter packs are all gone. Try again after 00:00 UTC.',
        TagCapReached: 'This network has had its starter packs for today.',
        Empty: 'Setup required: the gas station is out of AVAX.',
        TokensEmpty: 'Setup required: the gas station is out of test tokens.',
        AlreadyDripped: 'This wallet already got its starter pack.',
        NotNew: 'This wallet already has AVAX.',
      };
      throw new HttpError(known ? 409 : 502, known ? text[known]! : m.slice(0, 300));
    }
  }
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
