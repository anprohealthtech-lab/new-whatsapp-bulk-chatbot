# WhatsApp LIMS DigitalOcean Deployment Guide

## 🚀 Production-Ready WhatsApp LIMS Integration

This project integrates Laboratory Information Management Systems (LIMS) with WhatsApp for automated patient report delivery, optimized for DigitalOcean deployment with persistent sessions.

## Project Structure
- **NodeBackend/**: Contains the backend server and frontend code.
  - **server/**: The entry point for the backend, services for WhatsApp integration, message handling, and file management.
  - **src/**: Contains React components and pages for the frontend.
  - **uploads/**: Directory for storing uploaded files.
  - **sessions/**: Directory for storing WhatsApp session data.
- **shared/**: Contains the database schema definition.
- **migrations/**: Directory for database migrations.
- **docker-compose.yml**: Configuration for deploying the application using Docker.
- **Dockerfile**: Instructions for building the Docker image.
- **.env.production**: Environment variables for production.
- **deploy.sh**: Script for automating the deployment process.
- **README.md**: Documentation for the project.

## Deployment Instructions
1. **Clone the Repository**
   ```bash
   git clone <repository-url>
   cd whatsapp-lims-deployment
   ```

2. **Set Up Environment Variables**
   - Copy the `.env.production` file and update the values as needed for your production environment.

3. **Build the Docker Image**
   ```bash
   docker build -t whatsapp-lims .
   ```

4. **Run the Application with Docker Compose**
   ```bash
   docker-compose up -d
   ```

5. **Access the Application**
   - The application will be accessible at `http://<your-server-ip>:<port>`.

## Important Notes
- Ensure that the `uploads` and `sessions` directories are properly configured for persistent storage.
- The WhatsApp integration requires a valid WhatsApp number and session management to maintain connectivity.
- Monitor the logs for any issues during deployment and operation.

## Contributing
Feel free to submit issues or pull requests for improvements or bug fixes. 

## License
This project is licensed under the MIT License.