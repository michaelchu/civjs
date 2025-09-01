/**
 * Intelligence Dialog Component
 * 
 * Comprehensive intelligence report dialog with tabbed interface.
 * Based on freeciv-web intelligence system with modern design.
 * 
 * Reference: 
 * - reference/freeciv-web/freeciv-web/src/main/webapp/javascript/intel_dialog.js:67-144
 * - reference/freeciv-web/freeciv-web/src/main/webapp/webclient/intel.hbs
 */

import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Separator } from '../ui/separator';
import { 
  Building2, 
  Users, 
  Lightbulb, 
  Crown, 
  MapPin, 
  Coins, 
  TrendingUp,
  FlaskConical,
  Heart,
  Handshake,
  Swords
} from 'lucide-react';
import type { IntelligenceReport, DiplomaticState } from '../../../shared/src/types/nations';

interface IntelligenceDialogProps {
  playerId: string;
  playerName: string;
  nationName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const IntelligenceDialog: React.FC<IntelligenceDialogProps> = ({
  playerId,
  playerName,
  nationName,
  open,
  onOpenChange
}) => {
  const [activeTab, setActiveTab] = useState('overview');
  const { 
    intelligenceReports, 
    getPlayerEmbassyStatus,
    currentPlayerId 
  } = useGameStore();

  const report = intelligenceReports[playerId];
  const embassyStatus = currentPlayerId ? getPlayerEmbassyStatus(playerId) : null;
  const hasEmbassy = embassyStatus?.hasEmbassy || false;

  // If no embassy, show limited information
  if (!hasEmbassy && !report) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Building2 className="w-5 h-5" />
              <span>Intelligence Report - {nationName}</span>
            </DialogTitle>
          </DialogHeader>
          
          <div className="py-6">
            <div className="text-center space-y-4">
              <div className="mx-auto w-16 h-16 bg-muted rounded-full flex items-center justify-center">
                <Building2 className="w-8 h-8 text-muted-foreground" />
              </div>
              
              <div className="space-y-2">
                <h3 className="font-semibold">Limited Intelligence</h3>
                <p className="text-sm text-muted-foreground">
                  Ruler: {playerName}
                </p>
                <p className="text-xs text-muted-foreground mt-4">
                  Establishing an embassy will reveal detailed intelligence information.
                </p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!report) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Intelligence Report - {nationName}</DialogTitle>
          </DialogHeader>
          <div className="py-6 text-center">
            <p className="text-muted-foreground">Intelligence data not available</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const getDiplomaticStateInfo = (state: DiplomaticState) => {
    const stateMap = {
      'DS_WAR': { text: 'War', icon: Swords, color: 'destructive' },
      'DS_CEASEFIRE': { text: 'Ceasefire', icon: Handshake, color: 'secondary' },
      'DS_ARMISTICE': { text: 'Armistice', icon: Handshake, color: 'secondary' },
      'DS_PEACE': { text: 'Peace', icon: Handshake, color: 'default' },
      'DS_ALLIANCE': { text: 'Alliance', icon: Users, color: 'default' },
      'DS_TEAM': { text: 'Team', icon: Users, color: 'default' },
      'DS_NO_CONTACT': { text: 'No Contact', icon: Users, color: 'outline' }
    };
    
    return stateMap[state] || { text: state, icon: Users, color: 'outline' as const };
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Building2 className="w-5 h-5" />
            <span>Foreign Intelligence: {nationName} Empire</span>
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview" className="flex items-center space-x-2">
              <Crown className="w-4 h-4" />
              <span>Overview</span>
            </TabsTrigger>
            <TabsTrigger value="diplomacy" className="flex items-center space-x-2">
              <Users className="w-4 h-4" />
              <span>Diplomacy</span>
            </TabsTrigger>
            <TabsTrigger value="technology" className="flex items-center space-x-2">
              <Lightbulb className="w-4 h-4" />
              <span>Technology</span>
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="overflow-auto">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Crown className="w-5 h-5" />
                  <span>Empire Overview</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Basic Information */}
                  <div className="space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center space-x-3">
                        <Crown className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <span className="text-sm text-muted-foreground">Ruler</span>
                          <p className="font-medium">{report.ruler}</p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3">
                        <Building2 className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <span className="text-sm text-muted-foreground">Government</span>
                          <p className="font-medium">{report.government}</p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3">
                        <MapPin className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <span className="text-sm text-muted-foreground">Capital</span>
                          <p className="font-medium">{report.capital || '(unknown)'}</p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3">
                        <Coins className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <span className="text-sm text-muted-foreground">Gold</span>
                          <p className="font-medium">{report.gold}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Economic Information */}
                  <div className="space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center space-x-3">
                        <TrendingUp className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <span className="text-sm text-muted-foreground">Tax</span>
                          <p className="font-medium">{report.tax}%</p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3">
                        <FlaskConical className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <span className="text-sm text-muted-foreground">Science</span>
                          <p className="font-medium">{report.science}%</p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3">
                        <Heart className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <span className="text-sm text-muted-foreground">Luxury</span>
                          <p className="font-medium">{report.luxury}%</p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3">
                        <Lightbulb className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <span className="text-sm text-muted-foreground">Researching</span>
                          <p className="font-medium">{report.researching}</p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3">
                        <Building2 className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <span className="text-sm text-muted-foreground">Culture</span>
                          <p className="font-medium">{report.culture}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Diplomacy Tab */}
          <TabsContent value="diplomacy" className="overflow-auto">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Users className="w-5 h-5" />
                  <span>Diplomatic Relations</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {report.diplomaticRelations.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    No diplomatic contact with other nations
                  </p>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(
                      report.diplomaticRelations.reduce((acc, relation) => {
                        const stateInfo = getDiplomaticStateInfo(relation.state);
                        if (!acc[relation.state]) {
                          acc[relation.state] = {
                            state: stateInfo.text,
                            icon: stateInfo.icon,
                            color: stateInfo.color,
                            nations: []
                          };
                        }
                        acc[relation.state].nations.push(relation.playerId);
                        return acc;
                      }, {} as Record<string, any>)
                    ).map(([state, info]) => {
                      const Icon = info.icon;
                      return (
                        <div key={state} className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <Icon className="w-4 h-4" />
                            <Badge variant={info.color}>{info.state}</Badge>
                          </div>
                          <ul className="ml-6 space-y-1">
                            {info.nations.map((nationId: string) => (
                              <li key={nationId} className="text-sm text-muted-foreground">
                                • {nationId}
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Technology Tab */}
          <TabsContent value="technology" className="overflow-auto">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Lightbulb className="w-5 h-5" />
                  <span>Known Technologies</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {report.knownTechnologies.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    This civilization does not seem to invest in technology.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {report.knownTechnologies.map((tech) => (
                      <div key={tech.techId} className="flex items-center justify-between">
                        <span className="text-sm">{tech.name}</span>
                        <Badge 
                          variant={tech.whoKnows === 'both' ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          {tech.whoKnows === 'both' ? 'Both' : 
                           tech.whoKnows === 'them' ? 'They know' : 'We know'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};