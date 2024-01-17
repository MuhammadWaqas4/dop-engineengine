import { Chain } from '../models/engine-types';
import { DopSmartWalletContract } from './dop-smart-wallet/dop-smart-wallet';
import { RelayAdaptContract } from './relay-adapt/relay-adapt';

export class ContractStore {
  static readonly dopSmartWalletContracts: DopSmartWalletContract[][] = [];

  static readonly relayAdaptContracts: RelayAdaptContract[][] = [];

  static getDopSmartWalletContract(chain: Chain): DopSmartWalletContract {
    try {
      return this.dopSmartWalletContracts[chain.type][chain.id];
    } catch {
      throw new Error('No DopSmartWalletContract loaded.');
    }
  }

  static getRelayAdaptContract(chain: Chain): RelayAdaptContract {
    try {
      return this.relayAdaptContracts[chain.type][chain.id];
    } catch {
      throw new Error('No RelayAdaptContract loaded.');
    }
  }
}
