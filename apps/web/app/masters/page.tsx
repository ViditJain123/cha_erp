import { allExchangeRates, allImporters, allProductMemory, allTariff } from '@checklist/core';
import MastersView from './masters-view';

export const dynamic = 'force-dynamic';

export default async function MastersPage() {
  return (
    <MastersView
      initial={{
        tariff: allTariff(),
        importers: allImporters(),
        exchangeRates: allExchangeRates(),
        productMemory: allProductMemory(),
      }}
    />
  );
}
