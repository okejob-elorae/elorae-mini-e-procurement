import Link from "next/link";
import { WifiOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-static";

export default function PwaOfflinePage() {
  return (
    <div className="p-4">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="rounded-full bg-muted p-3">
            <WifiOff className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Kamu sedang offline</h1>
            <p className="text-sm text-muted-foreground">
              Halaman ini belum tersimpan. Buka dulu saat online, lalu bisa diakses offline.
            </p>
          </div>
          <Button asChild variant="secondary">
            <Link href="/pwa">Ke beranda</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
