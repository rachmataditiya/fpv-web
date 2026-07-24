import { MissionDef } from './missions';

export const DUST2_MISSIONS: MissionDef[] = [
  {
    id: 'dust2-holdout',
    name: 'Holdout',
    type: 'survive_waves',
    waves: 3,
    interWaveS: 10,
    briefing: 'Defend the position. Eliminate all incoming waves.',
  },
  {
    id: 'dust2-demolition',
    name: 'Demolition',
    type: 'hunt',
    huntPoints: [
      [20, 1, 10],
      [-30, 1, -20],
      [-50, 2, -60],
    ],
    briefing: 'Locate and destroy the three target locations.',
  },
  {
    id: 'dust2-intel-run',
    name: 'Intel Run',
    type: 'extract',
    pickupPoint: [-45, 3, -65],
    hoverS: 3,
    briefing: 'Retrieve intel from the hot zone and extract to the LZ.',
  },
];
