"use client";
import { WalletProvider } from "@/hooks/useWallet";
import { AuthProvider } from "@/hooks/useAuth";
import { GameProvider } from "@/hooks/useGame";
import { SoundProvider } from "@/hooks/useSound";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <AuthProvider>
        <GameProvider>
          <SoundProvider>
            {children}
          </SoundProvider>
        </GameProvider>
      </AuthProvider>
    </WalletProvider>
  );
}
