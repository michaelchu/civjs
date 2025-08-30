# Turn Resolution User Guide

## Overview

CivJS uses an advanced **synchronous turn resolution system** that processes all your actions together when you end your turn. This provides a smooth, reliable gameplay experience with real-time progress updates.

## How It Works

### Traditional vs. Modern Turn Processing

**❌ Old Way (Most Games):**
```
Move Unit A → Wait → Server Response
Attack with Unit B → Wait → Server Response  
Set Research → Wait → Server Response
End Turn → Wait → Server Response
```

**✅ CivJS Way:**
```
Move Unit A → Queued Locally ✓
Attack with Unit B → Queued Locally ✓  
Set Research → Queued Locally ✓
End Turn → Process Everything Together → Real-time Progress → New Turn Ready!
```

### Key Benefits

- 🚀 **Faster**: Single request instead of multiple round-trips
- 🔒 **Reliable**: All actions succeed or fail together  
- 📊 **Transparent**: See exactly what's happening during processing
- 🎯 **Atomic**: No partially-processed turns or inconsistent states

## The Turn Resolution Experience

When you click **"Turn Done"**, here's what happens:

### 1. Action Processing (0-30%)
- ✅ Your unit movements are executed
- ⚔️ Combat is resolved with damage calculations
- 🏛️ Cities are founded at chosen locations
- 🔬 Research selections are applied

### 2. AI Computation (30-60%)  
- 🤖 AI players analyze the map and plan their moves
- 🏃 AI units move and explore new territories
- ⚔️ AI combat decisions are made and executed
- 🏛️ AI cities grow and start new production

### 3. World Updates (70-90%)
- 🏭 City production completes (buildings, units, wonders)
- 📈 Population grows based on food surplus
- 🔬 Technology research progresses and may complete
- 🌍 Random events may occur (barbarians, natural disasters)

### 4. Turn Complete (100%)
- ✨ Your new turn begins immediately
- 📊 Updated game state loads instantly
- 🎮 You can start planning your next moves

## Visual Progress Indicators

The loading screen shows detailed progress information:

### Progress Bar Colors
- 🔵 **Blue**: Processing your actions
- 🟡 **Yellow**: AI players thinking and moving
- 🟠 **Orange**: World events and updates
- 🟢 **Green**: Turn complete!

### Status Messages
- *"Processing 3 player actions..."*
- *"AI #2 computing moves..."*  
- *"Updating world state..."*
- *"Turn resolution complete!"*

## Action Types

### Unit Actions
- **Move**: Units relocate to new positions
- **Attack**: Combat between military units
- **Fortify**: Units gain defensive bonuses
- **Explore**: Automated exploration of unknown areas

### City Actions  
- **Found City**: Establish new settlements
- **Change Production**: Switch what cities are building
- **Rush Production**: Spend gold to complete buildings/units

### Civilization Actions
- **Research Technology**: Select what to research next
- **Diplomatic Actions**: Trade agreements, declarations
- **Policy Changes**: Government and social policies

### Turn Management
- **End Turn**: Process all queued actions and advance

## Tips for Optimal Experience

### 🎯 Plan Before Acting
- Think through your entire turn before starting to move units
- Consider the consequences of each action on AI reactions
- Plan research and city production for long-term goals

### ⚡ Batch Your Actions
- Make all your moves before ending the turn
- The system processes everything optimally in one batch
- No need to wait between individual actions

### 📱 Stay Connected
- Keep your browser tab active during turn processing
- Don't close the tab while the progress screen is showing
- Poor network connections may slow down progress updates

### 🔄 Handle Interruptions
- If disconnected during processing, the turn will complete
- Refresh the page to see the updated game state
- Actions are safely queued and won't be lost

## Troubleshooting

### Turn Takes Too Long
**Normal Processing Times:**
- Simple turns: 1-3 seconds
- Complex turns with many actions: 3-8 seconds  
- Large games with multiple AI players: 5-15 seconds

**If processing exceeds 30 seconds:**
- Check your network connection
- Refresh the page to see if turn completed
- Contact support if issue persists

### Actions Don't Work
**Common Issues:**
- Unit has no movement points left
- Invalid target location (blocked by terrain/units)
- Insufficient resources for action (gold, research points)

**Solutions:**
- Check unit status before moving
- Ensure target locations are valid
- Verify you have required resources

### Progress Gets Stuck
**If progress stops updating:**
- Wait 30 seconds - complex AI decisions take time
- Check browser console for error messages
- Refresh page if no progress after 1 minute

### Turn Version Conflicts
**"Stale turn version" error:**
- Another player acted while you were planning
- Click "Refresh Game" to get latest state
- Plan your turn again with updated information

## Advanced Features

### Idempotent Requests
- Duplicate turn submissions are automatically detected
- Safe to retry if you're unsure if your turn processed
- No risk of double-processing actions

### Progress Persistence  
- Turn progress is saved if you close/refresh browser
- Come back to see completion status
- No need to stay on page during long AI processing

### Error Recovery
- Failed actions are clearly identified in results
- Successful actions are still applied
- Detailed error messages help identify problems

### Optimization Tips
- AI processing time scales with map size and number of AI players
- Consider smaller maps for faster turns
- Fewer AI opponents = quicker turn resolution

## Keyboard Shortcuts

- **Shift + Enter**: End turn (same as clicking Turn Done)
- **Escape**: Cancel current action selection  
- **Space**: Center map on selected unit
- **Tab**: Cycle through your units

## Performance Monitoring

The system automatically tracks:
- Turn resolution time
- Action success rates  
- Network connection quality
- AI processing efficiency

This data helps us continuously improve the turn resolution experience.

## Frequently Asked Questions

### Q: Can I undo actions after clicking Turn Done?
**A:** No, once turn processing begins, actions cannot be undone. Plan carefully before ending your turn.

### Q: What happens if my internet disconnects during turn processing?
**A:** Turn processing continues on the server. Refresh the page to see results when your connection returns.

### Q: Can I see what the AI is doing during their turn?
**A:** The progress indicators show general AI activity, but specific AI actions are revealed when your turn starts.

### Q: How long should I wait if turn processing seems stuck?
**A:** Wait up to 2 minutes for complex turns. If no progress after 2 minutes, refresh the page.

### Q: Does turn order matter for my actions?
**A:** Actions are processed in a logical order (movement, then combat, then city actions) regardless of the order you performed them.

### Q: Can I queue actions for future turns?
**A:** No, actions only apply to the current turn. You'll need to issue new commands each turn.

---

The synchronous turn resolution system is designed to make your CivJS experience smooth, reliable, and engaging. Each turn feels decisive and impactful, with clear feedback about what's happening in your civilization!