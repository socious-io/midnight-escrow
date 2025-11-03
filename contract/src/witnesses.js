// ES Module version for browser compatibility
export const witnesses = {
    create: (context, contributor, coin) => {
        return context;
    },
    release: (context, id, coin) => {
        // Register the coin's commitment so the runtime can qualify it
        // The commitment will be computed from the coin data
        // This allows the runtime to convert CoinInfo to QualifiedCoinInfo
        return context;
    }
};
