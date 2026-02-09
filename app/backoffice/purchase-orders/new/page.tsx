'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { POForm } from '@/components/forms/POForm';
import { createPO } from '@/app/actions/purchase-orders';
import { toast } from 'sonner';
import { OfflinePOButton } from '@/components/offline/OfflinePOButton';
import { offlineDB } from '@/lib/offline/db';
import { isOnline } from '@/lib/offline/sync';

interface Supplier {
  id: string;
  code: string;
  name: string;
}

export default function NewPOPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(true);

  useEffect(() => {
    const fetchSuppliers = async () => {
      try {
        // Try to get from cache first (for offline)
        const cached = await offlineDB.suppliers.toArray();
        if (cached.length > 0) {
          setSuppliers(cached.map(s => ({ id: s.id, code: s.code, name: s.name })));
        }

        // Fetch from API if online
        if (isOnline()) {
          const response = await fetch('/api/suppliers?sync=true');
          if (response.ok) {
            const data = await response.json();
            setSuppliers(data.map((s: any) => ({ id: s.id, code: s.code, name: s.name })));
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

  const handleSubmit = async (data: Parameters<typeof POForm>[0]['onSubmit'] extends (data: infer T) => any ? T : never) => {
    if (!session?.user?.id) {
      toast.error('You must be logged in');
      return;
    }

    setIsLoading(true);
    try {
      const po = await createPO(data, session.user.id);
      toast.success('Purchase Order created successfully');
      router.push(`/backoffice/purchase-orders/${po.id}`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to create PO');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveLocally = async () => {
    // This will be handled by the form's offline detection
    toast.info('PO will be saved locally and synced when online');
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Create New Purchase Order</h1>
        <p className="text-muted-foreground">
          Create a new purchase order for procurement
        </p>
      </div>

      <POForm
        suppliers={suppliers}
        onSubmit={handleSubmit}
        isLoading={isLoading}
      />
    </div>
  );
}
