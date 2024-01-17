import { Chain } from '../models/engine-types';
import { DopSmartWalletContract } from './railgun-smart-wallet/railgun-smart-wallet';
import { RelayAdaptContract } from './relay-adapt/relay-adapt';

export class ContractStore {
  static readonly railgunSmartWalletContracts: DopSmartWalletContract[][] = [];

  static readonly relayAdaptContracts: RelayAdaptContract[][] = [];

  static getDopSmartWalletContract(chain: Chain): DopSmartWalletContract {
    try {
      return this.railgunSmartWalletContracts[chain.type][chain.id];
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
