'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { GRNForm } from '@/components/grn/GRNForm';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { offlineDB } from '@/lib/offline/db';
import { isOnline } from '@/lib/offline/sync';

interface Supplier {
  id: string;
  code: string;
  name: string;
}

export default function NewGRNPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(true);

  useEffect(() => {
    const fetchSuppliers = async () => {
      try {
        const cached = await offlineDB.suppliers.toArray();
        if (cached.length > 0) {
          setSuppliers(cached.map((s) => ({ id: s.id, code: s.code, name: s.name })));
        }
        if (isOnline()) {
          const response = await fetch('/api/suppliers?sync=true');
          if (response.ok) {
            const data = await response.json();
            setSuppliers(data.map((s: Supplier) => ({ id: s.id, code: s.code, name: s.name })));
          }
        }
      } catch (error) {
        console.error('Failed to fetch suppliers:', error);
        toast.error('Failed to load suppliers');
      } finally {
        setIsLoadingSuppliers(false);
      }
    };
    fetchSuppliers();
  }, []);

  const handleSuccess = () => {
    router.push('/backoffice/inventory');
    router.refresh();
  };

  if (isLoadingSuppliers) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href="/backoffice/inventory">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Create Goods Receipt (GRN)</h1>
          <p className="text-muted-foreground">
            Record received goods with or without a PO reference
          </p>
        </div>
      </div>

      <GRNForm suppliers={suppliers} onSuccess={handleSuccess} />
    </div>
  );
}
