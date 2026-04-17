module github.com/project-customs/email-service

go 1.21

require (
	github.com/project-customs/email-service/smtp-server v0.1.0
	github.com/project-customs/email-service/email-service v0.1.0
)

replace (
	github.com/project-customs/email-service/smtp-server => ./go/smtp-server
	github.com/project-customs/email-service/email-service => ./go/email-service
)
