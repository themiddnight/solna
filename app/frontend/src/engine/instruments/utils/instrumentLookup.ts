import {
  InstrumentCategory,
} from "../shared/constants";
import {
  findInstrumentInCatalog,
  getDefaultInstrumentForCategoryFromCatalog,
} from "../shared/instrumentCatalog";

export const getInstrumentCategoryById = (
  instrumentId: string,
): InstrumentCategory => {
  return findInstrumentInCatalog(instrumentId)?.category ?? InstrumentCategory.Melodic;
};

export const getInstrumentLabelById = (
  instrumentId: string,
): string => {
  return findInstrumentInCatalog(instrumentId)?.instrument.label ?? "Select Instrument";
};

export const getDefaultInstrumentForCategory = (
  category: InstrumentCategory,
): string => {
  return getDefaultInstrumentForCategoryFromCatalog(category);
};
