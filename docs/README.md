# CivJS Documentation

Welcome to the CivJS technical and user documentation. This directory contains comprehensive guides for understanding, using, and contributing to the CivJS civilization game.

## 📚 Documentation Overview

### 🏗️ Architecture & Technical Guides

- **[Turn Resolution Architecture](turn-resolution-architecture.md)** - Complete technical architecture for the synchronous turn resolution system with Edge Functions and SSE streaming
- **[API Turn Resolution](api-turn-resolution.md)** - Detailed API documentation for the turn resolution endpoint, request/response formats, and integration guide

### 👥 User Guides

- **[Turn Resolution Guide](turn-resolution-guide.md)** - User-friendly guide explaining how the turn system works, what to expect during turn processing, and troubleshooting tips

## 🚀 Quick Start

If you're new to CivJS development:

1. Read the [main README](../README.md) for project setup
2. Check [Turn Resolution Architecture](turn-resolution-architecture.md) for system overview
3. Use [API Turn Resolution](api-turn-resolution.md) for implementation details

If you're a player looking to understand the game:

1. Start with [Turn Resolution Guide](turn-resolution-guide.md)
2. Check the troubleshooting sections for common issues

## 🎯 Key Features Documented

### Synchronous Turn Resolution
- **Batch Processing**: All player actions processed together
- **SSE Streaming**: Real-time progress updates during turn processing  
- **Edge Functions**: Scalable serverless execution on Vercel
- **Atomic Transactions**: All actions succeed or fail together
- **Rich UX**: Progress indicators, stage descriptions, and error handling

### Technical Implementation  
- **Action Queuing**: Client-side action buffering system
- **Version Control**: Turn version checking to prevent conflicts
- **Idempotency**: Safe request retries with duplicate detection
- **Error Handling**: Comprehensive error codes and recovery strategies
- **Performance**: Optimized for single-player games with AI opponents

## 📋 Documentation Standards

### Technical Documentation
- Include code examples with TypeScript interfaces
- Provide sequence diagrams for complex flows
- Document error conditions and recovery strategies  
- Include performance characteristics and monitoring

### User Documentation
- Use clear, non-technical language
- Include visual progress indicators and status descriptions
- Provide troubleshooting sections for common issues
- Include tips for optimal experience

## 🔄 Recent Updates

### v1.2.0 - Synchronous Turn Resolution
- **Added**: Complete turn resolution architecture documentation
- **Added**: Comprehensive API documentation with SSE streaming
- **Added**: User guide with visual progress indicators
- **Updated**: Migration guide from legacy individual action model

## 🤝 Contributing to Documentation

### Adding New Documentation
1. Follow the existing structure and naming conventions
2. Include both technical and user-facing perspectives
3. Add code examples and visual diagrams where helpful
4. Update this README with links to new documentation

### Documentation Review Process
1. Technical accuracy review by development team
2. User experience review by product team  
3. Copy editing for clarity and consistency
4. Integration testing with actual implementation

## 📞 Support and Questions

- **Technical Questions**: Check the architecture and API documentation
- **User Questions**: Start with the user guide and troubleshooting sections
- **Bug Reports**: Include relevant documentation sections in your reports
- **Feature Requests**: Reference documentation when proposing new features

## 🔗 Related Resources

### External Resources
- [Server-Sent Events Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [Vercel Edge Functions](https://vercel.com/docs/functions/edge-functions)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)

### Project Resources
- [Main Project README](../README.md)
- [Client README](../apps/client/README.md) 
- [Server README](../apps/server/README.md)
- [Contributing Guide](../CONTRIBUTING.md)

### Game Mechanics
- [Freeciv Manual](https://www.freeciv.org/manual/) - Reference for game rules
- [Civilization Wiki](https://civilization.fandom.com/) - General civilization game concepts

---

This documentation is continuously updated to reflect the latest features and improvements to CivJS. For the most current information, always refer to the documentation in the main branch of the repository.