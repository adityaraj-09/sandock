# Resource Management & Optimization Guide

This document outlines the comprehensive resource management and optimization features implemented in the Orchestrator API.

## 🚀 Key Improvements

### 1. Container Resource Limits
- **Memory Limits**: Configurable per-tier memory limits (256MB-2GB)
- **CPU Limits**: CPU shares and quota management
- **Disk Limits**: Storage size restrictions with tmpfs for writable directories
- **Network Limits**: File descriptor and process limits
- **Security**: Read-only root filesystem, non-root user execution

### 2. User Quotas & Tiers
- **Free Tier**: 2 sandboxes, 256MB RAM, 2-hour lifetime
- **Pro Tier**: 10 sandboxes, 1GB RAM, 24-hour lifetime  
- **Enterprise Tier**: 50 sandboxes, 2GB RAM, 1-week lifetime
- **API Key Limits**: Per-key sandbox limits
- **System Limits**: Global sandbox capacity management

### 3. Memory Management
- **Automatic Cleanup**: Expired sandbox removal every 15 minutes
- **Resource Monitoring**: Real-time memory, CPU, and network tracking
- **Leak Prevention**: Proper WebSocket and container cleanup
- **Stale Connection Handling**: Automatic timeout and cleanup

### 4. Container Size Optimization
- **Multi-stage Builds**: Optimized Docker images with minimal footprint
- **Image Caching**: Pre-pulled and cached container images
- **Unused Image Cleanup**: Automatic removal of unused images
- **Alpine Linux Base**: Smaller base images for reduced size

## 📊 New API Endpoints

### Resource Monitoring
```bash
# Get sandbox resource usage
GET /sandbox/{id}/stats
```

### Quota Management
```bash
# Get user quota and usage
GET /sandbox/quota/usage
```

### System Administration
```bash
# Get system-wide statistics (admin only)
GET /sandbox/system/stats

# Trigger cleanup (admin only)  
POST /sandbox/system/cleanup
```

## ⚙️ Configuration

### Environment Variables

#### Container Resource Limits
```bash
CONTAINER_MEMORY_LIMIT=536870912    # 512MB in bytes
CONTAINER_CPU_SHARES=512            # Relative CPU weight
CONTAINER_STORAGE_SIZE=1G           # Disk limit
```

#### User Quotas
```bash
MAX_SANDBOXES_PER_USER=5           # Per-user limit
MAX_SANDBOXES_PER_API_KEY=3        # Per-API-key limit
SANDBOX_LIFETIME_HOURS=24          # Auto-expiry time
```

#### System Limits
```bash
MAX_TOTAL_SANDBOXES=100            # System capacity
CLEANUP_INTERVAL_MINUTES=15        # Cleanup frequency
```

## 🏗️ Architecture Components

### ResourceManager Class
- **Quota Enforcement**: Validates sandbox creation limits
- **Resource Monitoring**: Tracks container resource usage
- **Cleanup Management**: Handles expired sandbox cleanup
- **Violation Detection**: Monitors resource threshold breaches

### ContainerOptimizer Class
- **Image Optimization**: Creates minimal container images
- **Startup Optimization**: Faster container initialization
- **Cache Management**: Pre-pulls and caches images
- **Recommendation Engine**: Suggests optimization improvements

### Enhanced Database Schema
- **Resource Tracking**: Logs resource usage over time
- **Tier Management**: User tier and limit tracking
- **System Metrics**: Historical system performance data

## 🔒 Security Enhancements

### Container Security
- **Non-root Execution**: All containers run as unprivileged user
- **Read-only Root**: Immutable root filesystem
- **No New Privileges**: Prevents privilege escalation
- **Resource Isolation**: Strict memory and CPU limits

### System Security
- **Rate Limiting**: API endpoint protection
- **Input Validation**: Zod schema validation
- **Error Handling**: Secure error messages
- **Audit Logging**: Comprehensive activity logging

## 📈 Monitoring & Metrics

### Real-time Monitoring
- Memory usage percentage and absolute values
- CPU utilization tracking
- Network I/O statistics
- Container health status

### Historical Data
- Resource usage trends over time
- User activity patterns
- System capacity utilization
- Performance optimization opportunities

### Alerting (Future Enhancement)
- Resource threshold violations
- System capacity warnings
- Unusual usage patterns
- Security event notifications

## 🚨 Resource Violation Handling

### Warning Thresholds
- **Memory**: Warning at 90%, critical at 95%
- **CPU**: Warning at sustained 90% usage
- **Disk**: Warning at 80% capacity

### Automatic Actions
- **Critical Memory**: Container termination
- **Expired Sandboxes**: Automatic cleanup
- **Stale Connections**: WebSocket cleanup
- **Resource Violations**: User notifications

## 🔧 Optimization Recommendations

### Container Optimization
- Right-sizing memory allocations
- CPU limit adjustments
- Image size reduction suggestions
- Startup time improvements

### System Optimization
- Load balancing recommendations
- Capacity planning insights
- Performance bottleneck identification
- Resource allocation optimization

## 📋 Best Practices

### For Developers
1. **Monitor Resource Usage**: Regularly check sandbox stats
2. **Optimize Applications**: Use memory and CPU efficiently
3. **Clean Up Resources**: Properly destroy unused sandboxes
4. **Use Appropriate Tiers**: Match tier to resource needs

### For Administrators
1. **Set Appropriate Limits**: Balance performance and capacity
2. **Monitor System Health**: Track overall resource usage
3. **Regular Cleanup**: Schedule maintenance tasks
4. **Capacity Planning**: Monitor growth trends

### For Production Deployment
1. **Configure Resource Limits**: Set appropriate container limits
2. **Enable Monitoring**: Set up alerting and metrics
3. **Backup Strategy**: Regular database backups
4. **Security Hardening**: Follow security best practices

## 🔄 Migration Guide

### Database Migration
```bash
# Run the resource tracking migration
npm run migrate
```

### Environment Update
```bash
# Copy new environment template
cp env.example .env
# Update with your specific values
```

### Docker Image Update
```bash
# Build optimized agent image
docker build -f docker/Dockerfile.agent.optimized -t sandbox-agent:optimized .
```

## 🚀 Future Enhancements

### Planned Features
- **Auto-scaling**: Dynamic resource allocation
- **Cost Tracking**: Usage-based billing integration
- **Advanced Analytics**: ML-powered optimization
- **Multi-region Support**: Geographic load distribution

### Integration Opportunities
- **Prometheus Metrics**: Advanced monitoring
- **Grafana Dashboards**: Visual analytics
- **Kubernetes Support**: Container orchestration
- **Cloud Provider APIs**: Native cloud integration

## 📞 Support & Troubleshooting

### Common Issues
1. **Container Won't Start**: Check resource limits and image availability
2. **High Memory Usage**: Review application memory patterns
3. **Slow Performance**: Analyze resource constraints and optimization recommendations
4. **Quota Exceeded**: Check user tier limits and usage

### Debug Commands
```bash
# Check container stats
curl -H "X-API-Key: your-key" http://localhost:3000/sandbox/{id}/stats

# View system status
curl -H "X-API-Key: your-key" http://localhost:3000/sandbox/system/stats

# Check quota usage
curl -H "X-API-Key: your-key" http://localhost:3000/sandbox/quota/usage
```

This comprehensive resource management system ensures optimal performance, prevents resource exhaustion, and provides detailed monitoring capabilities for the Orchestrator API.
