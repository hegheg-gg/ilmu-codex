import * as vscode from 'vscode';

export interface ModelUsageRecord {
  calls: number;
  tokens: number;
}

export interface ModelUsageStats {
  [model: string]: ModelUsageRecord;
}

export class UsageTracker {
  private static readonly STORAGE_KEY = 'ilmuCodex.modelUsageStats';
  private globalState: vscode.Memento;

  constructor(globalState: vscode.Memento) {
    this.globalState = globalState;
  }

  public getStats(): ModelUsageStats {
    return this.globalState.get<ModelUsageStats>(UsageTracker.STORAGE_KEY, {
      'ilmu-glm-5.3': { calls: 0, tokens: 0 },
      'ilmu-glm-5.3-flash': { calls: 0, tokens: 0 },
      'ilmu-v3.1': { calls: 0, tokens: 0 },
      'ilmu-mini-v3.3': { calls: 0, tokens: 0 }
    });
  }

  public async recordUsage(model: string, estimatedTokens: number) {
    const stats = this.getStats();
    if (!stats[model]) {
      stats[model] = { calls: 0, tokens: 0 };
    }
    stats[model].calls += 1;
    stats[model].tokens += estimatedTokens;

    await this.globalState.update(UsageTracker.STORAGE_KEY, stats);
  }

  public async resetStats() {
    await this.globalState.update(UsageTracker.STORAGE_KEY, {
      'ilmu-glm-5.3': { calls: 0, tokens: 0 },
      'ilmu-glm-5.3-flash': { calls: 0, tokens: 0 },
      'ilmu-v3.1': { calls: 0, tokens: 0 },
      'ilmu-mini-v3.3': { calls: 0, tokens: 0 }
    });
  }

  /**
   * Computes percentages for both calls and tokens across all tracked models.
   */
  public getBreakdown(): {
    totalCalls: number;
    totalTokens: number;
    models: {
      model: string;
      calls: number;
      callPercent: number;
      tokens: number;
      tokenPercent: number;
    }[];
  } {
    const stats = this.getStats();
    let totalCalls = 0;
    let totalTokens = 0;

    for (const key of Object.keys(stats)) {
      totalCalls += stats[key].calls;
      totalTokens += stats[key].tokens;
    }

    const models = Object.keys(stats).map((model) => {
      const calls = stats[model].calls;
      const tokens = stats[model].tokens;
      const callPercent = totalCalls > 0 ? Math.round((calls / totalCalls) * 100) : 0;
      const tokenPercent = totalTokens > 0 ? Math.round((tokens / totalTokens) * 100) : 0;

      return {
        model,
        calls,
        callPercent,
        tokens,
        tokenPercent
      };
    });

    // Sort by most used tokens/calls descending
    models.sort((a, b) => b.tokens - a.tokens);

    return {
      totalCalls,
      totalTokens,
      models
    };
  }
}
