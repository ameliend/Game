import { rpc, client } from './client';
import type { Avatar, World, Player, Message } from '../types';
export const islandService = {
  load: () => rpc<World>('load_world'),
  create: (username: string, avatar: Avatar) =>
    rpc('create_village', { p_username: username, p_name: 'Beuteu Island', p_avatar: avatar }),
};
export const action = (
  type: string,
  payload: Record<string, unknown> = {},
  requestId = crypto.randomUUID(),
) => rpc('game_action', { p_action: type, p_payload: payload, p_request: requestId });
export const economyService = {
  chop: (id: number) => action('chop', { id }),
  sell: (item: string, quantity: number) => action('sell', { item, quantity }),
};
export const agricultureService = {
  addPlot: (x: number, y: number) => action('add_plot', { x, y }),
  plant: (id: number, crop: string) => action('plant', { id, crop }),
  harvest: (id: number) => action('harvest', { id }),
  clear: (id: number) => action('clear', { id }),
};
export const constructionService = {
  place: (kind: string, x: number, y: number) => action('build', { kind, x, y }),
  move: (id: string, x: number, y: number) => action('move', { id, x, y }),
  assign: (id: string, userId: string) => action('assign', { id, user_id: userId }),
};
export const profileService = {
  avatar: (avatar: Avatar) => action('avatar', avatar),
  tutorial: (step: number) => action('tutorial', { step }),
};
export const communityService = { list: () => rpc<Player[]>('community') };
export const chatService = {
  async history() {
    const { data, error } = await client()
      .from('chat_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data as Message[]).reverse();
  },
  send: (content: string) =>
    rpc('send_message', { p_content: content, p_request: crypto.randomUUID() }),
  remove: (id: string) => rpc('delete_message', { p_id: id }),
  report: (id: string) => rpc('report_message', { p_id: id }),
};
