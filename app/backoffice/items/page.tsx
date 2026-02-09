'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Plus, 
  Search, 
  Package, 
  Edit, 
  Trash2, 
  MoreHorizontal,
  Layers,
  AlertTriangle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { getItems, deleteItem } from '@/app/actions/items';
import { ItemType } from '@prisma/client';

interface Item {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  type: ItemType;
  isActive: boolean;
  reorderPoint: string | null;
  uom: {
    code: string;
    nameId: string;
  };
  inventoryValue: {
    qtyOnHand: string;
    avgCost: string;
    totalValue: string;
  } | null;
}

const itemTypeLabels: Record<ItemType, string> = {
  FABRIC: 'Kain',
  ACCESSORIES: 'Aksesoris',
  FINISHED_GOOD: 'Barang Jadi'
};

const itemTypeColors: Record<ItemType, string> = {
  FABRIC: 'bg-blue-100 text-blue-800',
  ACCESSORIES: 'bg-purple-100 text-purple-800',
  FINISHED_GOOD: 'bg-green-100 text-green-800'
};

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ItemType | ''>('');

  const fetchItems = async () => {
    setIsLoading(true);
    try {
      const data = await getItems({
        search: searchQuery || undefined,
        type: typeFilter || undefined
      });
      setItems(data as Item[]);
    } catch (error) {
      toast.error('Failed to load items');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [searchQuery, typeFilter]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return;
    
    try {
      await deleteItem(id);
      toast.success('Item deleted successfully');
      fetchItems();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete item');
    }
  };

  const isLowStock = (item: Item) => {
    if (!item.reorderPoint || !item.inventoryValue) return false;
    return Number(item.inventoryValue.qtyOnHand) <= Number(item.reorderPoint);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Items</h1>
          <p className="text-muted-foreground">
            Manage fabric, accessories, and finished goods
          </p>
        </div>
        <Link href="/backoffice/items/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Item
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by SKU or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as ItemType | '')}
          className="px-3 py-2 rounded-md border bg-background"
        >
          <option value="">All Types</option>
          <option value="FABRIC">Fabric</option>
          <option value="ACCESSORIES">Accessories</option>
          <option value="FINISHED_GOOD">Finished Good</option>
        </select>
      </div>

      {/* Items Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Item List
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No items found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Avg Cost</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.sku}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{item.nameId}</p>
                          <p className="text-sm text-muted-foreground">{item.nameEn}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={itemTypeColors[item.type]}>
                          {itemTypeLabels[item.type]}
                        </Badge>
                      </TableCell>
                      <TableCell>{item.uom.code}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isLowStock(item) && (
                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                          )}
                          <span>
                            {Number(item.inventoryValue?.qtyOnHand || 0).toLocaleString()}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        Rp {Number(item.inventoryValue?.avgCost || 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        Rp {Number(item.inventoryValue?.totalValue || 0).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link href={`/backoffice/items/${item.id}`}>
                                <Edit className="mr-2 h-4 w-4" />
                                Edit
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/backoffice/items/${item.id}/bom`}>
                                <Layers className="mr-2 h-4 w-4" />
                                BOM
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              className="text-destructive"
                              onClick={() => handleDelete(item.id)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
