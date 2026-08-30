import React from 'react';
import { loadRegion } from '../store/loadRegion';
import { useAppStore } from '../store/store';

/**
 * The region picker shown on the four editing tabs (shared chrome, next to the
 * tab bar). Picking calls the same atomic loadRegion swap as the Arrange tab,
 * so it changes WHICH region the editing tabs target.
 */
export const RegionSelector: React.FC = () => {
  const regions = useAppStore((s) => s.regions);
  const activeRegionId = useAppStore((s) => s.activeRegionId);
  return (
    <select
      id="select-region"
      value={activeRegionId}
      onChange={(e) => loadRegion(e.target.value)}
      className="select select-sm select-ghost font-bold text-primary max-w-32"
      title="Active Region"
    >
      {regions.map((region) => (
        <option key={region.id} value={region.id}>
          {region.name}
        </option>
      ))}
    </select>
  );
};
