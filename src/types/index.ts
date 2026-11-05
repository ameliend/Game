import type { BuildingKind, CropKind } from '../config/game';
export type Avatar = { skin: string; hair: string; shirt: string; pants: string };
export type Profile = { id: string; username: string; tutorial_step: number; is_admin: boolean };
export type Island = { id: string; owner_id: string; name: string; gold: number; score: number };
export type Tree = { id: number; x: number; y: number; cut_at: string | null };
export type Plot = {
  id: number;
  x: number;
  y: number;
  owner_id?: string | null;
  owner_name?: string | null;
  house_id?: string | null;
};
export type Plantation = { plot_id: number; crop: CropKind; planted_at: string };
export type Building = {
  id: string;
  kind: BuildingKind;
  x: number;
  y: number;
  size: number;
  created_by?: string | null;
  assigned_to?: string | null;
  assigned_at?: string | null;
  built_at?: string;
  income_claimed_cycle?: number;
  income_started_at?: string | null;
};
export type World = {
  pol?: { id: string; x: number; y: number; until: string } | null;
  generation?: number;
  island: Island;
  profile: Profile;
  avatar: Avatar;
  trees: Tree[];
  plots: Plot[];
  plantations: Plantation[];
  buildings: Building[];
  inventory: Record<string, number>;
  server_time: string;
  governance?: Governance;
  exile?: { until: string };
};
export type Player = {
  id: string;
  username: string;
  island_name: string;
  island_id: string;
  score: number;
  building_count: number;
};
export type Message = {
  id: string;
  user_id: string;
  username: string;
  content: string;
  created_at: string;
};
export type Selection = {
  type: 'tree' | 'plot' | 'building' | 'ground' | 'income' | 'civic' | 'pol';
  id?: number | string;
  x: number;
  y: number;
};
export type Placement = { kind: BuildingKind | 'farm_plot'; movingId?: string } | null;

export type Regime = 'communism' | 'capitalism';
export type Election = {
  id: string;
  starts_at: string;
  closes_at: string;
  round?: number;
  round_started_at?: string;
  finalized_at: string | null;
  winner_id: string | null;
  result: string | null;
  candidates: { id: string; username: string; votes: number }[];
  my_vote: string | null;
  elector_count?: number;
  voted_count?: number;
  can_vote?: boolean;
};
export type Governance = {
  regime: Regime;
  mayor_id: string | null;
  epoch: string | null;
  election: Election | null;
  term_ends_at?: string | null;
  next_election_at?: string | null;
  exile_proposal?: ExileProposal | null;
};

export type Resident = {
  id: string;
  username: string;
  island: string;
  x: number;
  y: number;
  avatar: Avatar;
};

export type ExileProposal = {
  id: string;
  target_id: string;
  target_name: string;
  starts_at: string;
  closes_at: string;
  round: number;
  status: 'open' | 'accepted' | 'rejected';
  yes: number;
  no: number;
  my_vote: boolean | null;
  can_vote: boolean;
};
