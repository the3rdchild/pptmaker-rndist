export const PresentationGenerationApi = {
  async searchIcons(_options: {
    query: string;
    limit?: number;
    icon_weight?: string;
  }): Promise<string[]> {
    // Stub: icon search backend not wired yet.
    return [];
  },
};
