# 📋 DigitalOcean Deployment Checklist

## Pre-Deployment Setup

### ✅ Environment Preparation
- [ ] DigitalOcean account created and verified
- [ ] Domain name purchased (optional but recommended)
- [ ] doctl CLI installed and authenticated
- [ ] Docker installed on local machine (for testing)

### ✅ Database Setup
- [ ] DigitalOcean Managed PostgreSQL database created
  - Minimum: Basic 1GB RAM, 1 vCPU, 10GB storage
  - Region: Choose closest to your users
- [ ] Database connection string obtained
- [ ] Database firewall configured (if needed)

### ✅ Application Configuration
- [ ] `.env.production` file created and configured
- [ ] `SESSION_SECRET` generated (use: `openssl rand -base64 32`)
- [ ] `DATABASE_URL` set to PostgreSQL connection string
- [ ] CORS origins updated for your domain

## Deployment Options

### Option A: DigitalOcean App Platform (Recommended)
**Best for**: Easy management, auto-scaling, managed infrastructure

```bash
# Prerequisites
- [ ] GitHub repository created
- [ ] Code pushed to main branch
- [ ] .do/app.yaml configured

# Deploy steps
1. [ ] Ensure GitHub repository access permissions
2. [ ] Run: chmod +x deploy-do-app.sh
3. [ ] Run: ./deploy-do-app.sh
4. [ ] Set environment variables in DO dashboard
5. [ ] Configure custom domain (optional)
6. [ ] Test application endpoints
```

### Option B: DigitalOcean Droplet with Docker
**Best for**: Full control, custom configurations

```bash
# Prerequisites
- [ ] Droplet created (minimum 2GB RAM for Chrome)
- [ ] SSH access configured
- [ ] Docker and Docker Compose installed on droplet

# Deploy steps
1. [ ] Upload code to droplet
2. [ ] Run: chmod +x deploy.sh
3. [ ] Set environment variables
4. [ ] Run: ./deploy.sh
5. [ ] Configure reverse proxy (Nginx)
6. [ ] Set up SSL certificate
```

## Post-Deployment Verification

### ✅ Application Health
- [ ] Application starts without errors
- [ ] Health endpoint responds: `GET /api/health`
- [ ] Database connection successful
- [ ] File upload directory writable
- [ ] WhatsApp service initializes

### ✅ WhatsApp Integration
- [ ] QR code generates: `GET /api/qr-code`
- [ ] Mobile app can scan QR code
- [ ] WhatsApp session persists after restart
- [ ] Test message sends successfully

### ✅ API Endpoints Testing
- [ ] `POST /api/send-message` works
- [ ] `POST /api/send-report` accepts file uploads
- [ ] `GET /api/messages` returns message history
- [ ] `GET /api/status` shows WhatsApp connection

### ✅ Security & Performance
- [ ] SSL certificate configured (if using custom domain)
- [ ] Firewall rules configured
- [ ] Log rotation set up
- [ ] Database backups scheduled
- [ ] Monitor disk space for uploads/sessions

## Production Monitoring

### ✅ Essential Monitoring
- [ ] Application uptime monitoring
- [ ] Database performance monitoring
- [ ] WhatsApp connection status alerts
- [ ] Disk space monitoring (sessions/uploads)
- [ ] Memory usage monitoring (Chrome processes)

### ✅ Maintenance Tasks
- [ ] Daily database backups
- [ ] Weekly session directory backup
- [ ] Monthly security updates
- [ ] Quarterly dependency updates

## Scaling Considerations

### When to Scale Up
- [ ] CPU usage consistently > 80%
- [ ] Memory usage > 90%
- [ ] Response times > 5 seconds
- [ ] Message queue growing
- [ ] Multiple concurrent WhatsApp sessions needed

### Scaling Options
- [ ] Increase droplet/app size
- [ ] Add load balancer
- [ ] Implement Redis for session storage
- [ ] Move uploads to DigitalOcean Spaces
- [ ] Add multiple WhatsApp instances

## Troubleshooting Quick Reference

### Common Issues
- **Chrome crashes**: Increase memory, check --no-sandbox flag
- **WhatsApp disconnects**: Check mobile app connectivity
- **File uploads fail**: Check disk space and permissions
- **Database timeouts**: Scale database or optimize queries
- **Session lost**: Backup and restore session directory

### Emergency Procedures
- **App down**: Check logs, restart service
- **Database down**: Contact DO support, restore from backup
- **WhatsApp banned**: Use different phone number, new session
- **Disk full**: Clean uploads directory, extend storage

## Contact Information

### Support Resources
- DigitalOcean Documentation: https://docs.digitalocean.com/
- WhatsApp Business API: https://business.whatsapp.com/
- Application logs: `docker-compose logs -f`
- System logs: Available in DO dashboard

### Emergency Contacts
- [ ] Database admin contact: _______________
- [ ] Domain registrar support: _______________
- [ ] WhatsApp Business account owner: _______________

---

## 🎯 Success Criteria

Your deployment is successful when:
1. ✅ Application accessible via HTTPS
2. ✅ WhatsApp QR code scannable
3. ✅ Messages send and deliver reliably
4. ✅ File uploads work correctly
5. ✅ Session persists across restarts
6. ✅ Database operations function normally
7. ✅ All API endpoints respond correctly

**Final Test**: Send a test lab report via API and confirm delivery to WhatsApp!