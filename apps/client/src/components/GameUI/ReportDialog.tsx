import React from 'react';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { HudDialogContent } from './HudDialogContent';

interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: React.ReactNode;
}

/** Shared dialog shell for the map's larger management reports. */
export const ReportDialog: React.FC<ReportDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  children,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <HudDialogContent className="overflow-hidden">
      <DialogHeader>
        <DialogTitle className="text-white">{title}</DialogTitle>
        <DialogDescription className="text-slate-400">{description}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </HudDialogContent>
  </Dialog>
);
