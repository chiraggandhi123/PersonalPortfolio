import React from "react";
import { Container, Row, Col } from "react-bootstrap";
import Particle from "../Particle";
import "../../style.css";
import "bootstrap/dist/css/bootstrap.min.css";
import Github from "./Github";
import Techstack from "./Techstack";
import Aboutcard from "./AboutCard";
import laptopImg from "../../Assets/about.png";

function About() {
  return (
    <Container fluid className="about-section">
      <Particle />
      <Container>
        <Row style={{ justifyContent: "center", padding: "10px" }}>
          <Col
            md={7}
            style={{
              justifyContent: "center",
              paddingTop: "30px",
              paddingBottom: "50px",
            }}
          >
            <h1 style={{ fontSize: "2.1em", paddingBottom: "20px" }}>
              Know Who <strong className="purple">I'M</strong>
            </h1>
            <Aboutcard />
          </Col>
          <Col
            md={5}
            style={{ paddingTop: "120px", paddingBottom: "50px" }}
            className="about-img"
          >
            <img src={laptopImg} alt="about" className="img-fluid" />
          </Col>
        </Row>
        <h1 className="project-heading">
          <strong className="purple">Languages</strong>
        </h1>
        <Row style={{ justifyContent: "center", paddingBottom: "50px" }}>
          <Techstack iconName="devicon-cplusplus-line" />
          <Techstack iconName="devicon-javascript-plain " />
          <Techstack iconName="devicon-python-plain-wordmark " />
        </Row>
        <h1 className="project-heading">
          <strong className="purple">Tools and Technologies</strong>
        </h1>
        <Row>
          <Techstack iconName="devicon-nodejs-plain-wordmark " />
          <Techstack iconName="devicon-express-original-wordmark" />
          <Techstack iconName="devicon-react-original-wordmark" />
          <Techstack iconName="devicon-redux-plain " />
          <Techstack iconName="devicon-jquery-plain-wordmark " />
          <Techstack iconName="devicon-mongodb-plain-wordmark" />
          <Techstack iconName="devicon-bootstrap-plain-wordmark" />
          <Techstack iconName="devicon-handlebars-plain-wordmark " />
          <Techstack iconName="devicon-html5-plain-wordmark " />
          <Techstack iconName="devicon-css3-plain-wordmark " />
          <Techstack iconName="cib-visual-studio-code" />
          <Techstack iconName="cib-postman" />

        </Row>
        <h1 className="project-heading">
          <strong className="purple">Version Control</strong>
        </h1>
        <Row style={{ justifyContent: "center", paddingBottom: "50px" }}>
          <Techstack iconName="devicon-git-plain-wordmark" />
          <Techstack iconName="devicon-gitlab-plain-wordmark" />
          <Techstack iconName="devicon-bitbucket-plain-wordmark" />
          <Techstack iconName="devicon-jira-plain-wordmark" />

        </Row>
        <h1 className="project-heading">
          <strong className="purple">Familiar with</strong>
        </h1>
        <Row style={{ justifyContent: "center", paddingBottom: "50px" }}>
          <Techstack iconName="devicon-tensorflow-original" />
          <Techstack iconName="devicon-flask-plain-wordmark" />
          <Techstack iconName="devicon-jupyter-plain-wordmark" />
          <Techstack iconName="devicon-numpy-original-wordmark" />
          <Techstack iconName="devicon-postgresql-plain-wordmark" />
          <Techstack iconName="devicon-postgresql-plain-wordmark" />          
          
          

        </Row>
        {/* <Github /> */}
      </Container>
    </Container>
  );
}

export default About;
