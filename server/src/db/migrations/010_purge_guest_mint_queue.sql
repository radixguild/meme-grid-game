-- Guest players have no wallet, so their address can never appear in a mint
-- manifest — those queue rows can only fail their retries and then sit as
-- permanent noise. queueNftMint() now refuses them at the source; this clears
-- the ones queued before that guard existed.
--
-- Only the QUEUE row goes. The unlock itself stays in nft_unlocks, so guests
-- keep the achievement in-game (gallery + XP) exactly as before.
DELETE FROM nft_mint_queue WHERE radix_address NOT LIKE 'account_%';
