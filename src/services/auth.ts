import { client } from './client';
export const authService = {
  async signIn(email: string, password: string) {
    const { error } = await client().auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  async signUp(email: string, password: string) {
    const { data, error } = await client().auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
    return data;
  },
  async reset(email: string) {
    const { error } = await client().auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) throw error;
  },
  async updatePassword(password: string) {
    const { error } = await client().auth.updateUser({ password });
    if (error) throw error;
  },
  async signOut() {
    const { error } = await client().auth.signOut();
    if (error) throw error;
  },
};
